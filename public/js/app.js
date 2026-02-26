function _dbg(msg) {
  var el = document.getElementById('_app_dbg');
  if (!el) { el = document.createElement('div'); el.id = '_app_dbg'; el.style = 'position:fixed;bottom:30px;left:0;right:0;background:#0a0a2e;color:#0f0;font-size:11px;padding:4px 8px;z-index:9999;'; document.body.appendChild(el); }
  el.textContent = msg; console.log('[app]', msg);
}

// 랜딩 페이지 — 페르소나 카드 렌더링
async function loadPersonas() {
  _dbg('loadPersonas() 시작');
  const grid = document.getElementById('persona-grid');
  if (!grid) { _dbg('ERROR: persona-grid 없음'); return; }

  try {
    _dbg('fetch /api/personas 중...');
    const res = await fetch('/api/personas');
    _dbg('fetch 완료: status=' + res.status);
    const personas = await res.json();
    _dbg('personas 수신: ' + personas.length + '개');

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
    _dbg('ERROR: ' + err.message);
    if (grid) grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:2rem;">
        <p style="color:#ef4444;margin-bottom:1rem;">서버 연결 실패: ${err.message}</p>
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
  var path = location.pathname;
  _dbg('DOMContentLoaded | path=' + path);
  if (path.includes('index') || path === '/') {
    _dbg('loadPersonas 호출 시도...');
    try {
      var p = loadPersonas();
      _dbg('loadPersonas 호출됨 (Promise 반환)');
      if (p && p.catch) p.catch(function(e) { _dbg('PROMISE ERR: ' + e.message); });
    } catch(e) {
      _dbg('loadPersonas THROW: ' + e.message);
    }
  } else {
    _dbg('path 불일치: ' + path);
  }
});
