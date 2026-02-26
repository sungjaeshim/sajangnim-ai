// DB 헬퍼 - 대화 관리 API 래퍼
window.db = {
  // 대화 목록 조회
  async getConversations() {
    const token = await window.supabaseAuth.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch('/api/conversations', { headers });
    if (!res.ok) throw new Error('대화 목록 조회 실패');
    return await res.json();
  },

  // 새 대화 생성
  async createConversation(personaId, firstMessage) {
    const token = await window.supabaseAuth.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const title = firstMessage.slice(0, 100) || '새 대화';

    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers,
      body: JSON.stringify({ personaId, title }),
    });

    if (!res.ok) throw new Error('대화 생성 실패');
    return await res.json();
  },

  // 메시지 저장
  async saveMessage(conversationId, role, content, modelUsed) {
    const token = await window.supabaseAuth.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ role, content, modelUsed }),
    });

    if (!res.ok) throw new Error('메시지 저장 실패');
    return await res.json();
  },

  // 대화 메시지 조회
  async getMessages(conversationId) {
    const token = await window.supabaseAuth.getToken();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/conversations/${conversationId}/messages`, { headers });
    if (!res.ok) throw new Error('메시지 조회 실패');
    return await res.json();
  },
};
