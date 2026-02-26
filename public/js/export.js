// TXT 내보내기 (PDF 제거 — 한글 깨짐)

window.exportChat = {
  // TXT 내보내기 — window.chatMessages 배열 우선, 없으면 DOM 수집
  toTXT(messages, personaName) {
    // window.chatMessages 우선 사용
    const msgs = (window.chatMessages && window.chatMessages.length > 0)
      ? window.chatMessages
      : messages;

    if (!msgs || msgs.length === 0) {
      alert('내보낼 대화가 없습니다.');
      return;
    }

    const name = personaName || document.getElementById('persona-name')?.textContent?.trim()?.replace(/^.\s*/, '') || 'AI';
    const header = `사장님AI — ${name}\n${new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' })}\n${'='.repeat(40)}\n\n`;

    const lines = msgs.map(m =>
      `[${m.role === 'user' ? '나' : name}]\n${m.content}`
    );

    const blob = new Blob([header + lines.join('\n\n---\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `사장님AI_${name}_${new Date().toLocaleDateString('ko')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // PDF 미지원
  toPDF() {
    alert('PDF 내보내기는 현재 지원하지 않습니다. TXT로 저장해주세요.');
  }
};
