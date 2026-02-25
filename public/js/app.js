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
    grid.innerHTML = '<p style="color:#ef4444;text-align:center;grid-column:1/-1">서버 연결 실패. 잠시 후 다시 시도해주세요.</p>';
  }
}

loadPersonas();
