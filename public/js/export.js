// jsPDF 의존 (chat.html에서 CDN 로드)
// 한글 PDF 지원: 기본 폰트는 한글 깨짐 → TXT 권장

window.exportChat = {
  // 현재 대화 메시지 수집
  getMessages() {
    const messages = [];
    const messageEls = document.querySelectorAll('.chat-messages .message');
    messageEls.forEach(el => {
      const role = el.classList.contains('user') ? 'user' : 'assistant';
      const content = el.textContent || el.innerText;
      if (content && !el.classList.contains('error')) {
        messages.push({ role, content });
      }
    });
    return messages;
  },

  // 페르소나 이름 가져오기
  getPersonaName() {
    const el = document.getElementById('persona-name');
    return el ? el.textContent.trim().replace(/^.\s*/, '') : 'AI';
  },

  // TXT 내보내기
  toTXT(messages, personaName) {
    if (!messages || messages.length === 0) {
      alert('내보낼 대화가 없습니다.');
      return;
    }

    const lines = messages.map(m =>
      `[${m.role === 'user' ? '나' : personaName}]\n${m.content}\n`
    );

    const blob = new Blob([lines.join('\n---\n\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `사장님AI_${personaName}_${new Date().toLocaleDateString('ko')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // PDF 내보내기 (jsPDF - 영문 전용, 한글 깨짐)
  async toPDF(messages, personaName) {
    if (!messages || messages.length === 0) {
      alert('내보낼 대화가 없습니다.');
      return;
    }

    // jsPDF 로드 확인
    if (!window.jsPDF) {
      alert('PDF 라이브러리 로딩 중입니다. 잠시 후 다시 시도해주세요.');
      return;
    }

    const { jsPDF } = window.jsPDF;
    const doc = new jsPDF();

    // 페이지 설정
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;
    let yPosition = margin;

    // 헤더 (서비스명 + 페르소나 + 날짜)
    doc.setFontSize(18);
    doc.text('Sajangnim AI', margin, yPosition);
    yPosition += 8;

    doc.setFontSize(12);
    doc.text(`Persona: ${personaName}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Date: ${new Date().toLocaleDateString('ko')}`, margin, yPosition);
    yPosition += 6;

    // 구분선
    doc.setLineWidth(0.5);
    doc.line(margin, yPosition, pageWidth - margin, yPosition);
    yPosition += 10;

    // 대화 내용
    doc.setFontSize(10);
    let currentPage = 1;

    messages.forEach((msg, idx) => {
      const roleLabel = msg.role === 'user' ? 'You' : personaName;
      const roleText = `[${roleLabel}]: `;
      const contentText = msg.content;

      // 역할 라벨
      doc.setFont('helvetica', 'bold');
      const roleLines = doc.splitTextToSize(roleText, maxWidth);
      roleLines.forEach(line => {
        if (yPosition > pageHeight - margin) {
          doc.addPage();
          currentPage++;
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      });

      // 내용 (영문만 깔끔하게 표시)
      doc.setFont('helvetica', 'normal');
      const contentLines = doc.splitTextToSize(contentText, maxWidth);
      contentLines.forEach(line => {
        if (yPosition > pageHeight - margin) {
          doc.addPage();
          currentPage++;
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      });

      // 구분
      yPosition += 3;
    });

    // 한글 경고 문구
    yPosition += 5;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Note: Korean characters may not display correctly. For full Korean support, please use TXT export.', margin, yPosition);

    // 페이지 번호
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    }

    doc.save(`사장님AI_${personaName}_${new Date().toLocaleDateString('ko')}.pdf`);
  },

  // 메시지 수 확인
  getMessageCount() {
    return this.getMessages().length;
  }
};
