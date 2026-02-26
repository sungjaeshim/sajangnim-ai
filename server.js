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

// 오픈 베타 기간: glm-4.7-flash 통일
function selectModel(userMessage) {
  return { model: 'glm-4.7-flash', thinking: false };
}

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

// 대화 요약 생성 (GLM fast)
async function generateSummary(messages) {
  try {
    const recent = messages.slice(-10);
    const dialogue = recent.map(m => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n');
    const res = await glm.chat.completions.create({
      model: 'glm-4.7-flash',
      messages: [
        {
          role: 'system',
          content: '다음 대화를 3줄 이내로 요약하라. 사용자의 업종, 핵심 문제, 논의된 해결책 위주로. 한국어로.'
        },
        { role: 'user', content: dialogue }
      ],
      max_tokens: 200,
      extra_body: { enable_thinking: false }
    });
    return res.choices[0]?.message?.content || null;
  } catch (e) {
    console.error('[summary] 생성 실패:', e.message);
    return null;
  }
}

// 선택적 JWT 검증 (비로그인도 허용)
async function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && supabaseAdmin) {
    try {
      const { data: { user } } = await supabaseAdmin.auth.getUser(token);
      req.user = user || null;
    } catch (e) {
      req.user = null;
    }
  } else {
    req.user = null;
  }
  next();
}

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

// 대화 목록 조회
app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id, title, persona_id, updated_at')
      .eq('user_id', req.user.id)
      .order('updated_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Get conversations error:', err);
    res.status(500).json({ error: '대화 목록 조회 실패' });
  }
});

// 새 대화 생성
app.post('/api/conversations', requireAuth, async (req, res) => {
  const { personaId, title } = req.body;

  if (!personaId || !title) {
    return res.status(400).json({ error: '필수 필드 누락' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .insert({
        user_id: req.user.id,
        persona_id: personaId,
        title: title.slice(0, 100), // 최대 100자 제한
      })
      .select('id')
      .single();

    if (error) throw error;
    res.json({ id: data.id });
  } catch (err) {
    console.error('Create conversation error:', err);
    res.status(500).json({ error: '대화 생성 실패' });
  }
});

// 메시지 저장
app.post('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  const conversationId = req.params.id;
  const { role, content, modelUsed } = req.body;

  if (!role || !content) {
    return res.status(400).json({ error: '필수 필드 누락' });
  }

  try {
    // 대화 소유권 확인
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single();

    if (!conv) {
      return res.status(403).json({ error: '접근 권한 없음' });
    }

    const { error } = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role,
        content: content.slice(0, 10000),
        model_used: modelUsed || 'glm-4.7',
      });

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Save message error:', err);
    res.status(500).json({ error: '메시지 저장 실패' });
  }
});

// 메시지 저장 헬퍼 (백그라운드)
async function saveMessages(conversationId, userMsg, assistantMsg, modelUsed) {
  try {
    // 대화 소유권 확인 후 메시지 저장
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .single();

    if (!conv) return;

    await supabaseAdmin.from('messages').insert([
      {
        conversation_id: conversationId,
        role: userMsg.role,
        content: userMsg.content,
        model_used: null, // user 메시지는 model 없음
      },
      {
        conversation_id: conversationId,
        role: assistantMsg.role,
        content: assistantMsg.content,
        model_used: modelUsed,
      },
    ]);
  } catch (err) {
    console.error('Save messages error:', err);
  }
}

// 대화 메시지 조회
app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  const conversationId = req.params.id;

  try {
    // 대화 소유권 확인
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id, persona_id')
      .eq('id', conversationId)
      .eq('user_id', req.user.id)
      .single();

    if (!conv) {
      return res.status(403).json({ error: '접근 권한 없음' });
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('role, content, model_used, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ personaId: conv.persona_id, messages: data || [] });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: '메시지 조회 실패' });
  }
});

// 채팅 API (SSE)
app.post('/api/chat', optionalAuth, async (req, res) => {
  const { persona: personaId, messages, sessionId, formatMode, conversationId } = req.body;

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

  // 이전 대화 요약 컨텍스트 주입 (로그인 사용자만)
  let narrativeContext = '';
  if (req.user && supabaseAdmin) {
    try {
      // 1) 현재 페르소나의 최근 대화 요약 1개
      const { data: personaConvs } = await supabaseAdmin
        .from('conversations')
        .select('summary, updated_at')
        .eq('user_id', req.user.id)
        .eq('persona_id', personaId)
        .not('summary', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1);

      // 2) 전체 페르소나 통합 최근 요약 1개 (다른 페르소나)
      const { data: otherConvs } = await supabaseAdmin
        .from('conversations')
        .select('summary, persona_id, updated_at')
        .eq('user_id', req.user.id)
        .neq('persona_id', personaId)
        .not('summary', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1);

      const parts = [];

      if (personaConvs && personaConvs.length > 0) {
        parts.push(`[지난 대화 요약] ${personaConvs[0].summary}`);
      }
      if (otherConvs && otherConvs.length > 0) {
        parts.push(`[다른 상담에서 파악한 사용자 정보] ${otherConvs[0].summary}`);
      }

      if (parts.length > 0) {
        narrativeContext = `\n\n## 이 사용자 맥락\n${parts.join('\n')}\n\n위 맥락을 자연스럽게 참고하되, 굳이 언급하지 말고 이미 알고 있는 것처럼 대화하라.`;
      }
    } catch (e) {
      console.error('[narrative] 컨텍스트 로드 실패:', e.message);
    }
  }

  // 포맷 모드에 따른 시스템 프롬프트 수정
  let systemPrompt = persona.systemPrompt + narrativeContext;
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
    // 모델 자동선택 (마지막 user 메시지 기준)
    const lastUserMessage = [...session.messages].reverse().find(m => m.role === 'user')?.content || '';
    const modelConfig = selectModel(lastUserMessage);
    console.log(`🤖 Model selected: ${modelConfig.model} (thinking: ${modelConfig.thinking})`);

    const stream = await glm.chat.completions.create({
      model: modelConfig.model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...session.messages.slice(-40),
      ],
      stream: true,
      max_tokens: 4096,
      extra_body: { enable_thinking: false },
    });

    res.write(`data: ${JSON.stringify({ type: 'start', model: modelConfig.model })}\n\n`);
    let fullResponse = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta || {};
      const text = delta.content || '';
      // reasoning_content는 클라이언트에 전송하지 않음
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: 'delta', text })}\n\n`);
      }
    }

    session.messages.push({ role: 'assistant', content: fullResponse });

    // 대화 ID가 있으면 메시지 저장 (백그라운드)
    if (conversationId) {
      saveMessages(conversationId, messages[messages.length - 1], { role: 'assistant', content: fullResponse }, modelConfig.model)
        .catch(err => console.error('Message save error:', err));
    }

    // turn_count 증가 및 5턴마다 요약 생성 (로그인 사용자 + Supabase 연동 시)
    if (conversationId && req.user && supabaseAdmin) {
      (async () => {
        try {
          const { data: conv } = await supabaseAdmin
            .from('conversations')
            .select('turn_count')
            .eq('id', conversationId)
            .single();

          const newTurnCount = (conv?.turn_count || 0) + 1;

          if (newTurnCount % 5 === 0) {
            const allMessages = [...session.messages];
            const summary = await generateSummary(allMessages);
            await supabaseAdmin
              .from('conversations')
              .update({ summary, turn_count: newTurnCount, updated_at: new Date().toISOString() })
              .eq('id', conversationId);
            console.log(`[narrative] 요약 저장 완료 (turn ${newTurnCount}):`, summary?.slice(0, 50));
          } else {
            await supabaseAdmin
              .from('conversations')
              .update({ turn_count: newTurnCount, updated_at: new Date().toISOString() })
              .eq('id', conversationId);
          }
        } catch (e) {
          console.error('[turn_count] 업데이트 실패:', e.message);
        }
      })();
    }

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
