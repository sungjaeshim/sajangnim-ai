import express from 'express';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { getPersona, getAllPersonas } from './personas/index.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rate limiting (in-memory)
const rateLimitMap = new Map();
const RATE_LIMIT = 20; // 분당 20요청
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + RATE_WINDOW;
  }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const API_KEY = process.env.GLM_API_KEY || process.env.ZAI_API_KEY;
const API_BASE = 'https://api.z.ai/api/coding/paas/v4';

if (!API_KEY) console.error('⚠️ GLM_API_KEY not set!');

// GLM 클라이언트 (OpenAI 호환)
const glm = new OpenAI({
  baseURL: API_BASE,
  apiKey: API_KEY,
});

// Supabase 관리자 클라이언트 (JWT 검증용)
const supabaseAdmin = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

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

// Supabase 설정 전달 (프론트엔드용)
app.get('/api/config', (req, res) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase 설정 누락' });
  }
  res.json({
    supabaseUrl: process.env.SUPABASE_URL.trim(),
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY.trim()
  });
});

// JWT 검증 미들웨어
async function requireAuth(req, res, next) {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: '인증 시스템이 설정되지 않았습니다' });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: '로그인이 필요합니다' });
  }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) {
    return res.status(401).json({ error: '인증 실패' });
  }

  req.user = user;
  next();
}

// 채팅 API (SSE)
app.post('/api/chat', requireAuth, async (req, res) => {
  const { persona: personaId, messages, sessionId, formatMode } = req.body;

  // Rate limiting
  const ip = req.ip || req.connection.remoteAddress;
  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  // Input validation
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }
  if (messages.length > 50) {
    return res.status(400).json({ error: 'messages array too long (max 50)' });
  }
  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'invalid message format' });
    }
    if (msg.content.length > 10000) {
      return res.status(400).json({ error: 'message content too long (max 10000 chars)' });
    }
  }
  if (!personaId || !sessionId) {
    return res.status(400).json({ error: '필수 필드 누락' });
  }

  const persona = getPersona(personaId);
  if (!persona) return res.status(400).json({ error: 'Invalid persona' });

  // 포맷 모드에 따른 시스템 프롬프트 수정
  let systemPrompt = persona.systemPrompt;
  if (formatMode === 'plain') {
    systemPrompt += '\n\n## 응답 형식 규칙\n절대로 마크다운, 이모지, 굵은 글씨(**텍스트**), 목록(-, *, •, 숫자), 헤더(#)를 사용하지 마세요. 자연스러운 한국어 줄글(산문) 형식으로만 답변하세요.';
  }

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
        { role: 'system', content: systemPrompt },
        ...session.messages.slice(-40),
      ],
      stream: true,
      max_tokens: 4096,
      extra_body: { enable_thinking: false },
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
