// 실제 구현 — var로 선언해서 window.loadPersonas와 분리
var _doLoadPersonas = async function() {
  var grid = document.getElementById('persona-grid');
  if (!grid) return;

  try {
    var res = await fetch('/api/personas');
    var personas = await res.json();

    grid.innerHTML = '';

    personas.forEach(function(persona) {
      var card = document.createElement('a');
      card.className = 'persona-card';
      card.href = '/chat?persona=' + persona.id;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', persona.name + ' (' + persona.role + '): ' + persona.description);

      card.innerHTML =
        '<div class="color-bar" style="background:' + persona.color + '"></div>' +
        '<div class="card-icon">' + persona.icon + '</div>' +
        '<div class="card-name">' + persona.name + '</div>' +
        '<div class="card-role">' + persona.role + '</div>' +
        '<div class="card-desc">' + persona.description + '</div>';

      // auth 완료 전 클릭 시 최대 3초 대기 후 이동
      card.addEventListener('click', function(e) {
        if (window._authReady) return; // 이미 완료 → 기본 href 동작
        e.preventDefault();
        var href = card.href;
        var attempts = 0;
        var check = setInterval(function() {
          if (window._authReady || attempts++ > 30) {
            clearInterval(check);
            location.href = href;
          }
        }, 100);
      });

      grid.appendChild(card);
    });
  } catch (err) {
    console.error('[app] loadPersonas 실패:', err);
    if (grid) grid.innerHTML =
      '<div style="grid-column:1/-1;text-align:center;padding:2rem;">' +
        '<p style="color:#ef4444;margin-bottom:1rem;">연결 실패</p>' +
        '<button id="retry-btn">🔄 다시 시도</button>' +
      '</div>';
    document.addEventListener('click', function(e) {
      if (e.target.id === 'retry-btn') _doLoadPersonas();
    });
  }
};

// auth.js 등 외부에서 window.loadPersonas() 호출 가능하게 노출
window.loadPersonas = function() { return _doLoadPersonas(); };

// DOMContentLoaded에서 직접 실행
document.addEventListener('DOMContentLoaded', function() {
  var path = location.pathname;
  if (path.includes('index') || path === '/') {
    _doLoadPersonas();
  }
});
