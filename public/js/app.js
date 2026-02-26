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

// auth.js가 requireLogin() + redirect 담당
// app.js는 페르소나 로드만 담당 (auth.js DOMContentLoaded 이후 실행)
function initApp() {
  loadPersonas();
}

// window.loadPersonas = initApp 으로 auth.js에서 호출 가능하게 노출
window.loadPersonas = initApp;
