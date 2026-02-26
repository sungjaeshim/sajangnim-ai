// 랜딩 페이지 — 페르소나 카드 렌더링
async function loadPersonas() {
  const grid = document.getElementById('persona-grid');

  try {
    const res = await fetch('/api/personas');
    const personas = await res.json();

    grid.innerHTML = '';

    personas.forEach(persona => {
      const card = document.createElement('a');
      card.className = 'persona-card';
      card.href = `/chat?persona=${persona.id}`;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${persona.name} (${persona.role}): ${persona.description}`);

      card.innerHTML = `
        <div class="color-bar" style="background:${persona.color}"></div>
        <div class="card-icon">${persona.icon}</div>
        <div class="card-name">${persona.name}</div>
        <div class="card-role">${persona.role}</div>
        <div class="card-desc">${persona.description}</div>
      `;

      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:2rem;">
        <p style="color:#ef4444;margin-bottom:1rem;">서버 연결 실패</p>
        <button id="retry-btn" aria-label="다시 시도">🔄 다시 시도</button>
      </div>
    `;
    // 다시 시도 버튼 이벤트
    document.addEventListener('click', (e) => {
      if (e.target.id === 'retry-btn') loadPersonas();
    });
  }
}

function initApp() {
  loadPersonas();
}

// auth.js에서 호출 가능하게 노출
window.loadPersonas = initApp;

// DOMContentLoaded에서 직접 실행 (requireLogin 결과 무관하게)
// head script가 이미 비로그인 redirect 처리함
document.addEventListener('DOMContentLoaded', function() {
  // OAuth 콜백 (#access_token) 포함한 모든 index 페이지에서 바로 로드
  var path = location.pathname;
  if (path.includes('index') || path === '/') {
    loadPersonas();
  }
});
