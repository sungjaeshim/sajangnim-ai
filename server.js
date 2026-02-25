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

// GLM 클라이언트 (OpenAI 호환)
const glm = new OpenAI({
  baseURL: 'https://api.z.ai/api/coding/paas/v4',
  apiKey: process.env.GLM_API_KEY || process.env.ZAI_API_KEY,
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

// 페르소나별 모델 맵
const MODEL_MAP = {
  dojun:  'glm-4.7',
  jia:    'glm-4.7',
  eric:   'glm-4.7-flash',  // 분석 → 빠른 flash
  hana:   'glm-4.7',
  minjun: 'glm-4.7-flash',  // 분석 → 빠른 flash
};

// 페르소나 목록 API
app.get('/api/personas', (req, res) => {
  res.json(getAllPersonas());
});

// 채팅 API (SSE 스트리밍)
app.post('/api/chat', async (req, res) => {
  const { persona: personaId, messages, sessionId } = req.body;

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
    const model = MODEL_MAP[personaId] || 'glm-4.7';

    const stream = await glm.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: persona.systemPrompt },
        ...recentMessages,
      ],
      stream: true,
      max_tokens: 4096,
    });

    res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);

    let fullResponse = '';

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      }
    }

    session.messages.push({ role: 'assistant', content: fullResponse });
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    console.error('API error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI 서비스 연결에 실패했습니다.' })}\n\n`);
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
