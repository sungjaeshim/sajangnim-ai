import express from 'express';
import OpenAI from 'openai';
import { getPersona, getAllPersonas } from './personas/index.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.GLM_API_KEY || process.env.ZAI_API_KEY;
const API_BASE = 'https://api.z.ai/api/coding/paas/v4';

if (!API_KEY) console.error('⚠️ GLM_API_KEY not set!');

// Custom fetch: enable_thinking: false 주입
const glm = new OpenAI({
  baseURL: API_BASE,
  apiKey: API_KEY,
  fetch: async (url, init) => {
    // request body에 enable_thinking: false 주입
    if (init?.body) {
      try {
        const body = JSON.parse(init.body);
        body.enable_thinking = false;
        init = { ...init, body: JSON.stringify(body) };
      } catch {}
    }
    return globalThis.fetch(url, init);
  },
});

// 인메모리 세션 (MVP)
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > SESSION_TTL) sessions.delete(id);
  }
}, 60_000);

app.get('/api/personas', (req, res) => res.json(getAllPersonas()));

// 채팅 API (SSE)
app.post('/api/chat', async (req, res) => {
  const { persona: personaId, messages, sessionId } = req.body;
  if (!personaId || !Array.isArray(messages) || !messages.length || !sessionId) {
    return res.status(400).json({ error: '필수 필드 누락' });
  }

  const persona = getPersona(personaId);
  if (!persona) return res.status(400).json({ error: 'Invalid persona' });

  let session = sessions.get(sessionId);
  if (!session) {
    session = { messages: [], lastActive: Date.now() };
    sessions.set(sessionId, session);
  }
  session.lastActive = Date.now();
  session.messages.push(messages[messages.length - 1]);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const stream = await glm.chat.completions.create({
      model: 'glm-4.7-flash',
      messages: [
        { role: 'system', content: persona.systemPrompt },
        ...session.messages.slice(-40),
      ],
      stream: true,
      max_tokens: 4096,
    });

    res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);
    let fullResponse = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta || {};
      const text = delta.content || '';
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      }
    }

    session.messages.push({ role: 'assistant', content: fullResponse });
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Chat error:', err.message, err.status);
    res.write(`data: ${JSON.stringify({ type: 'error', message: getErrorMessage(err) })}\n\n`);
    res.end();
  }

// 에러 메시지 매핑
function getErrorMessage(err) {
  if (err.status === 429) {
    return '⏸️ 잠시 후 다시 시도해주세요. (요청이 너무 많아요)';
  }
  if (err.status === 401) {
    return '🔑 인증 오류가 발생했습니다.';
  }
  if (err.status && err.status >= 500) {
    return '🤖 서버 오류입니다. 잠시 후 다시 시도해주세요.';
  }
  return '⚠️ 연결에 실패했습니다.';
}
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

if (process.env.NODE_ENV !== 'production' || process.env.PORT) {
  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => console.log(`🏪 사장님AI: http://localhost:${PORT}`));
}

export default app;
