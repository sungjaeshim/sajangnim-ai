import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { getPersona, getAllPersonas } from './personas/index.js';

const app = express();
app.use(express.json());
app.use(express.static('public'));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-6-20250514',
      max_tokens: 4096,
      system: persona.systemPrompt,
      messages: recentMessages,
    });

    res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);

    let fullResponse = '';

    stream.on('text', (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
    });

    stream.on('end', () => {
      session.messages.push({ role: 'assistant', content: fullResponse });
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (err) => {
      console.error('Stream error:', err);
      res.write(`data: ${JSON.stringify({ type: 'error', message: '응답 생성 중 오류가 발생했습니다.' })}\n\n`);
      res.end();
    });
  } catch (err) {
    console.error('API error:', err);
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'AI 서비스 연결에 실패했습니다.' })}\n\n`);
    res.end();
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// SPA 폴백
app.get('/chat', (req, res) => res.sendFile('chat.html', { root: 'public' }));

// 로컬 실행용
if (process.env.NODE_ENV !== 'production' || process.env.PORT) {
  const PORT = process.env.PORT || 3100;
  app.listen(PORT, () => console.log(`🏪 사장님AI 서버 시작: http://localhost:${PORT}`));
}

// Vercel 서버리스 export
export default app;
