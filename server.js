import express from 'express';
import { getPersona, getAllPersonas } from './personas/index.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.GLM_API_KEY || process.env.ZAI_API_KEY;
const API_URL = 'https://api.z.ai/api/coding/paas/v4/chat/completions';

if (!API_KEY) console.error('⚠️ GLM_API_KEY not set!');

// 인메모리 세션 (MVP)
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > SESSION_TTL) sessions.delete(id);
  }
}, 60_000);

// 페르소나 목록 API
app.get('/api/personas', (req, res) => {
  res.json(getAllPersonas());
});

// 채팅 API (SSE 스트리밍) — fetch 직접 호출
app.post('/api/chat', async (req, res) => {
  const { persona: personaId, messages, sessionId } = req.body;

  if (!personaId || !Array.isArray(messages) || messages.length === 0 || !sessionId) {
    return res.status(400).json({ error: '필수 필드가 누락되었습니다.' });
  }

  const persona = getPersona(personaId);
  if (!persona) return res.status(400).json({ error: 'Invalid persona' });

  let session = sessions.get(sessionId);
  if (!session) {
    session = { messages: [], lastActive: Date.now() };
    sessions.set(sessionId, session);
  }
  session.lastActive = Date.now();

  const userMsg = messages[messages.length - 1];
  session.messages.push(userMsg);
  const recentMessages = session.messages.slice(-40);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'glm-4.7-flash',
        messages: [
          { role: 'system', content: persona.systemPrompt },
          ...recentMessages,
        ],
        stream: true,
        max_tokens: 4096,
        enable_thinking: false,  // thinking 모드 비활성화
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('GLM API error:', response.status, errText);
      res.write(`data: ${JSON.stringify({ type: 'error', message: `API ${response.status}: ${errText.slice(0,100)}` })}\n\n`);
      return res.end();
    }

    res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') continue;
        
        try {
          const data = JSON.parse(jsonStr);
          const delta = data.choices?.[0]?.delta || {};
          const text = delta.content || delta.reasoning_content || '';
          
          if (text) {
            fullResponse += text;
            res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
          }
        } catch {}
      }
    }

    session.messages.push({ role: 'assistant', content: fullResponse });
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('API error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: `연결 실패: ${err.message}` })}\n\n`);
    res.end();
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// SPA 폴백
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

// 로컬 실행용
if (process.env.NODE_ENV !== 'production' || process.env.PORT) {
  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => console.log(`🏪 사장님AI 서버 시작: http://localhost:${PORT}`));
}

// Vercel 서버리스 export
export default app;
