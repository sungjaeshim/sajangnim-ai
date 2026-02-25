// 채팅 페이지
const params = new URLSearchParams(location.search);
const personaId = params.get('persona');
const sessionId = crypto.randomUUID();

let isStreaming = false;
let currentColor = '#4F46E5';

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

async function sendMessage() {
  const text = input.value.trim();
  if (!text || isStreaming) return;

  input.value = '';
  input.style.height = 'auto';
  addMessage('user', text);

  isStreaming = true;
  document.getElementById('send-btn').disabled = true;

  addTypingIndicator();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        persona: personaId,
        sessionId,
        messages: [{ role: 'user', content: text }],
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
  } catch (err) {
    removeTypingIndicator();
    addMessage('assistant', '⚠️ 네트워크 오류. 잠시 후 다시 시도해주세요.');
  }

  isStreaming = false;
  document.getElementById('send-btn').disabled = false;
  input.focus();
}

// 이벤트 리스너 (event delegation)
document.addEventListener('click', (e) => {
  if (e.target.id === 'send-btn' || e.target.closest('#send-btn')) sendMessage();
  if (e.target.id === 'back-btn' || e.target.closest('#back-btn')) location.href = '/';
});

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 초기화
async function init() {
  if (!personaId) return location.href = '/';

  try {
    const res = await fetch('/api/personas');
    const personas = await res.json();
    const persona = personas.find(p => p.id === personaId);
    if (!persona) return location.href = '/';

    currentColor = persona.color;
    document.getElementById('persona-name').textContent = `${persona.icon} ${persona.name}`;
    document.getElementById('header-bar').style.backgroundColor = persona.color;
    document.getElementById('send-btn').style.background = persona.color;
    document.title = `${persona.icon} ${persona.name} — 사장님AI`;

    addMessage('assistant', persona.greeting);
  } catch (err) {
    addMessage('assistant', '⚠️ 서버 연결 실패. 새로고침 해주세요.');
  }
}

init();
