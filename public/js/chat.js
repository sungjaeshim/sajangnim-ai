// 채팅 페이지
const params = new URLSearchParams(location.search);
const personaId = params.get('persona');
const sessionId = crypto.randomUUID();

let isStreaming = false;
let currentColor = '#4F46E5';
let formatMode = localStorage.getItem(`formatMode_${personaId}`) !== 'plain' ? 'structured' : 'plain';
let currentConversationId = null;
let conversations = [];

// 마크다운 → HTML 변환 (기본)
function formatMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    // 테이블 처리
    .replace(/\|(.+)\|\n\|[-| :]+\|\n((?:\|.+\|\n?)+)/g, (match, header, rows) => {
      const ths = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      const trs = rows.trim().split('\n').map(row => {
        const tds = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    })
    .replace(/\n/g, '<br>');
}

function addMessage(role, content) {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  if (role === 'user') {
    div.style.background = currentColor;
  }
  div.innerHTML = formatMarkdown(content);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  // 내보내기용 배열 동기화
  if (content) {
    if (!window.chatMessages) window.chatMessages = [];
    window.chatMessages.push({ role, content });
  }
  return div;
}

function addTypingIndicator() {
  const container = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.id = 'typing';
  div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTypingIndicator() {
  document.getElementById('typing')?.remove();
}

// 자동 높이 조절
const input = document.getElementById('chat-input');
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});

// 사이드바 토글 (모바일: open 클래스, 데스크톱: collapsed 클래스)
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth >= 768) {
    sidebar.classList.toggle('collapsed');
  } else {
    sidebar.classList.toggle('open');
  }
}

// 대화 목록 로드
async function loadConversations() {
  try {
    conversations = await window.db.getConversations();
    renderConversations();
  } catch (err) {
    console.error('Failed to load conversations:', err);
  }
}

const PERSONA_INFO = {
  dojun: { name: '도준', role: '전략가', icon: '🎯' },
  eric:  { name: '에릭', role: 'CFO',    icon: '💰' },
  hana:  { name: '하나', role: '브랜딩', icon: '✨' },
  jia:   { name: '지아', role: '마케터', icon: '📱' },
  minjun:{ name: '민준', role: '상권분석', icon: '📍' }
};

// 대화 목록 렌더링
function renderConversations() {
  const container = document.getElementById('conversation-list');
  if (conversations.length === 0) {
    container.innerHTML = '<div class="conversation-empty">대화 기록이 없습니다</div>';
    return;
  }

  container.innerHTML = conversations.map(conv => {
    const date = new Date(conv.updated_at);
    const dateStr = date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
    const isActive = conv.id === currentConversationId ? 'active' : '';
    const pi = PERSONA_INFO[conv.persona_id] || { name: conv.persona_id, role: '', icon: '💬' };
    const personaLabel = pi.role ? `${pi.name} · ${pi.role}` : pi.name;

    return `
      <div class="conversation-item ${isActive}" data-id="${conv.id}" data-persona="${conv.persona_id}">
        <div class="conv-persona">
          <span class="conv-persona-icon">${pi.icon}</span>
          <span class="conv-persona-name">${personaLabel}</span>
        </div>
        <div class="conversation-title">${conv.title}</div>
        <div class="conversation-meta">${dateStr}</div>
        <button class="conv-delete" data-id="${conv.id}" aria-label="삭제">🗑️</button>
      </div>
    `;
  }).join('');
}

// 대화 클릭 핸들러
async function handleConversationClick(convId, convPersonaId) {
  // 현재 페르소나와 다르면 페이지 이동
  if (convPersonaId !== personaId) {
    location.href = `/chat?persona=${convPersonaId}`;
    return;
  }

  currentConversationId = convId;
  clearMessages();

  try {
    const data = await window.db.getMessages(convId);
    data.messages.forEach(msg => {
      addMessage(msg.role, msg.content);
    });
    renderConversations();
    closeSidebar();
  } catch (err) {
    console.error('Failed to load conversation:', err);
    addMessage('assistant', '⚠️ 대화를 불러오는 데 실패했습니다.');
  }
}

// 새 대화 시작
function startNewConversation() {
  currentConversationId = null;
  clearMessages();
  renderConversations();
  closeSidebar();
  addMessage('assistant', window.currentPersona?.greeting || '안녕하세요! 새 대화를 시작합니다.');
}

function clearMessages() {
  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  window.chatMessages = [];
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
}

// 날짜 포맷팅
function formatDate(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '오늘';
  if (diffDays === 1) return '어제';
  if (diffDays < 7) return `${diffDays}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isStreaming) return;

  input.value = '';
  input.dispatchEvent(new Event('input')); // textarea auto-resize 초기화
  input.blur();
  setTimeout(() => { input.focus(); }, 0);
  addMessage('user', text);

  isStreaming = true;
  document.getElementById('send-btn').disabled = true;

  addTypingIndicator();

  try {
    // 대화 ID가 없으면 새 대화 생성
    if (!currentConversationId) {
      const { id } = await window.db.createConversation(personaId, text);
      currentConversationId = id;
      await loadConversations();
    }

    // JWT 토큰 가져오기
    const token = await window.supabaseAuth.getToken();

    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        persona: personaId,
        sessionId,
        messages: [{ role: 'user', content: text }],
        formatMode,
        conversationId: currentConversationId,
      }),
    });

    removeTypingIndicator();
    const aiDiv = addMessage('assistant', '');
    let fullText = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'delta') {
            fullText += data.text;
            aiDiv.innerHTML = formatMarkdown(fullText);
            document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
          } else if (data.type === 'error') {
            aiDiv.className = 'message error';
            aiDiv.innerHTML = `⚠️ ${data.message}`;
          }
        } catch {}
      }
    }

    // 스트리밍 완료 후 chatMessages에 저장
    if (fullText) {
      if (!window.chatMessages) window.chatMessages = [];
      window.chatMessages.push({ role: 'assistant', content: fullText });
    }

    // 대화 제목 업데이트 (첫 응답이면)
    const convIndex = conversations.findIndex(c => c.id === currentConversationId);
    if (convIndex >= 0 && conversations[convIndex].title === text.slice(0, 100)) {
      await loadConversations();
    }
  } catch (err) {
    removeTypingIndicator();
    const errorDiv = addMessage('assistant', '⚠️ 네트워크 오류가 발생했습니다.');
    errorDiv.innerHTML += `
      <button class="retry-btn" data-text="${text}" aria-label="메시지 다시 전송">🔄 다시 시도</button>
    `;
  }

  isStreaming = false;
  document.getElementById('send-btn').disabled = false;
  input.focus();
}

// 이벤트 리스너 (event delegation)
document.addEventListener('click', (e) => {
  // 전송 버튼
  if (e.target.id === 'send-btn' || e.target.closest('#send-btn')) sendMessage();

  // 뒤로 가기 버튼
  if (e.target.id === 'back-btn' || e.target.closest('#back-btn')) location.href = '/';

  // 사이드바 토글
  if (e.target.closest('#sidebar-toggle')) toggleSidebar();

  // 사이드바 닫기
  if (e.target.id === 'sidebar-close' || e.target.closest('#sidebar-close')) closeSidebar();

  // 새 대화 버튼
  if (e.target.id === 'new-chat-btn' || e.target.closest('#new-chat-btn')) startNewConversation();

  // 대화 삭제 버튼
  const deleteBtn = e.target.closest('.conv-delete');
  if (deleteBtn) {
    e.stopPropagation();
    const convId = deleteBtn.getAttribute('data-id');
    if (confirm('이 대화를 삭제할까요?')) {
      window.db.deleteConversation(convId).then(ok => {
        if (ok) {
          if (currentConversationId === convId) {
            currentConversationId = null;
            clearMessages();
          }
          loadConversations();
        }
      });
    }
    return;
  }

  // 대화 아이템 클릭
  const convItem = e.target.closest('.conversation-item');
  if (convItem) {
    const convId = convItem.getAttribute('data-id');
    const convPersonaId = convItem.getAttribute('data-persona');
    handleConversationClick(convId, convPersonaId);
  }

  // 다시 시도 버튼
  if (e.target.classList.contains('retry-btn')) {
    const retryText = e.target.getAttribute('data-text');
    input.value = retryText;
    sendMessage();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

// 토글 UI 업데이트
function updateToggleUI() {
  const toggle = document.getElementById('format-toggle');
  const label = document.getElementById('toggle-label');
  const isStructured = formatMode === 'structured';
  toggle.checked = isStructured;
  label.textContent = isStructured ? '📝 구조화' : '📄 줄글';
}

// 포맷 토글 이벤트 핸들러
function setupFormatToggle() {
  const toggle = document.getElementById('format-toggle');
  toggle.addEventListener('change', () => {
    formatMode = toggle.checked ? 'structured' : 'plain';
    localStorage.setItem(`formatMode_${personaId}`, formatMode);
    updateToggleUI();
  });
}

// 초기화
async function init() {
  if (!personaId) return location.href = '/';

  // 로그인 확인
  await window.supabaseAuth.requireLogin();

  try {
    const res = await fetch('/api/personas');
    const personas = await res.json();
    const persona = personas.find(p => p.id === personaId);
    if (!persona) return location.href = '/';

    window.currentPersona = persona;
    currentColor = persona.color;
    document.getElementById('persona-name').textContent = `${persona.icon} ${persona.name}`;
    document.getElementById('header-bar').style.backgroundColor = persona.color;
    document.getElementById('send-btn').style.background = persona.color;
    document.title = `${persona.icon} ${persona.name} — 사장님AI`;

    updateToggleUI();
    setupFormatToggle();

    addMessage('assistant', persona.greeting);

    // 대화 목록 로드
    await loadConversations();
  } catch (err) {
    addMessage('assistant', '⚠️ 서버 연결 실패. 새로고침 해주세요.');
  }
}

init();

// 내보내기 버튼 이벤트
document.addEventListener('click', function(e) {
  const exportBtn = document.getElementById('export-btn');
  const exportMenu = document.getElementById('export-menu');

  if (e.target.closest('#export-btn')) {
    exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
    return;
  }
  if (e.target.closest('.export-option')) {
    const format = e.target.closest('.export-option').dataset.format;
    const personaName = window.currentPersona?.name || '사장님';
    if (format === 'txt') window.exportChat.toTXT(window.chatMessages || [], personaName);
    if (format === 'pdf') window.exportChat.toPDF(window.chatMessages || [], personaName);
    exportMenu.style.display = 'none';
    return;
  }
  // 외부 클릭 시 메뉴 닫기
  if (exportMenu && !e.target.closest('#export-wrapper')) {
    exportMenu.style.display = 'none';
  }
});
