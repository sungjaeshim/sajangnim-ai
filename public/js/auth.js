// Supabase Auth 모듈
let supabase = null;
let user = null;
let _authReady = false; // true after first successful login/session restore

// Supabase 초기화
async function initSupabase() {
  if (supabase) return supabase;

  try {
    // CDN 로드 확인
    if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase CDN 로드 실패');
    }

    const config = await fetch('/api/config').then(r => {
      if (!r.ok) throw new Error('설정 로드 실패');
      return r.json();
    });
    supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

    // 세션 변경 감지
    supabase.auth.onAuthStateChange((event, session) => {
      console.log('[auth] onAuthStateChange:', event, !!session);
      user = session?.user || null;

      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        _authReady = true;
      } else if (event === 'SIGNED_OUT' && _authReady) {
        // Only redirect on SIGNED_OUT if we previously had a valid session.
        // This prevents redirect during OAuth callback before setSession() runs.
        location.href = '/login.html';
      }
      // INITIAL_SESSION with null session → ignore (requireLogin handles redirect)
    });

    return supabase;
  } catch (err) {
    console.error('Supabase 초기화 실패:', err);
    return null;
  }
}

// 인증 가드 - 로그인이 필요한 페이지
async function requireLogin() {
  const returnUrl = encodeURIComponent(location.pathname + location.search);
  const hash = location.hash || '';

  // OAuth 콜백: URL hash에 access_token 있으면 직접 setSession 호출
  if (hash.includes('access_token')) {
    try {
      const params = new URLSearchParams(hash.slice(1));
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token') || '';
      const sb = await initSupabase();
      if (sb && accessToken) {
        const { data, error } = await sb.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (data?.session) {
          _authReady = true;
          history.replaceState(null, '', location.pathname);
          user = data.session.user;
          return true;
        }
      }
    } catch (e) { console.error('[auth] OAuth callback 처리 실패:', e); }
    location.href = `/login.html?returnUrl=${returnUrl}`;
    return false;
  }

  // ① 빠른 체크: localStorage에 세션 없으면 즉시 redirect (네트워크 불필요)
  const SESSION_KEY = 'sb-xczegfsgxlnsvsmmrgaz-auth-token';
  const cached = localStorage.getItem(SESSION_KEY);
  if (!cached) {
    location.href = `/login.html?returnUrl=${returnUrl}`;
    return false;
  }

  // ② localStorage에 세션 있으면 Supabase로 검증
  const sb = await initSupabase();
  if (!sb) {
    location.href = `/login.html?returnUrl=${returnUrl}&error=${encodeURIComponent('초기화 실패')}`;
    return false;
  }

  // ③ getSession 검증 (3초 타임아웃)
  let session = null;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
    const result = await Promise.race([sb.auth.getSession(), timeout]);
    session = result?.data?.session || null;
  } catch {
    // 타임아웃: localStorage 있으니 일단 통과 (만료된 세션은 API에서 걸림)
    const raw = JSON.parse(cached);
    session = raw?.session || raw || null;
  }

  if (!session) {
    location.href = `/login.html?returnUrl=${returnUrl}`;
    return false;
  }

  _authReady = true;
  user = session.user;
  return true;
}

// 현재 토큰 반환
async function getToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

// 카카오 로그인
async function signInWithKakao() {
  const sb = await initSupabase();
  if (!sb) {
    showError('카카오 로그인을 할 수 없습니다');
    return;
  }

  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/index.html`,
        queryParams: {
          prompt: 'select_account'
        }
      }
    });

    if (error) throw error;
  } catch (err) {
    showError('카카오 로그인 실패: ' + err.message);
  }
}

// 구글 로그인
async function signInWithGoogle() {
  const sb = await initSupabase();
  if (!sb) {
    showError('구글 로그인을 할 수 없습니다');
    return;
  }

  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/index.html`,
        queryParams: {
          prompt: 'select_account'
        }
      }
    });

    if (error) throw error;
  } catch (err) {
    showError('구글 로그인 실패: ' + err.message);
  }
}

// 이메일 로그인
async function signInWithEmail(email, password) {
  const sb = await initSupabase();
  if (!sb) {
    showError('로그인을 할 수 없습니다');
    return false;
  }

  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    // 로그인 성공
    const returnUrl = new URLSearchParams(location.search).get('returnUrl');
    location.href = returnUrl ? decodeURIComponent(returnUrl) : '/index.html';
    return true;
  } catch (err) {
    showError('로그인 실패: ' + getKoreanError(err.message));
    return false;
  }
}

// 이메일 회원가입
async function signUpWithEmail(email, password) {
  const sb = await initSupabase();
  if (!sb) {
    showError('회원가입을 할 수 없습니다');
    return false;
  }

  try {
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login.html`
      }
    });

    if (error) throw error;

    // 이메일 인증 필요
    if (data.user && !data.session) {
      showError('가입된 이메일로 인증 링크가 발송되었습니다. 확인 후 로그인해주세요.');
      return true;
    }

    // 자동 로그인
    const returnUrl = new URLSearchParams(location.search).get('returnUrl');
    location.href = returnUrl ? decodeURIComponent(returnUrl) : '/index.html';
    return true;
  } catch (err) {
    showError('회원가입 실패: ' + getKoreanError(err.message));
    return false;
  }
}

// 로그아웃
async function signOut() {
  const sb = await initSupabase();
  if (!sb) return;

  try {
    await sb.auth.signOut();
    location.href = '/login.html';
  } catch (err) {
    console.error('로그아웃 실패:', err);
    location.href = '/login.html';
  }
}

// 에러 메시지 한글화
function getKoreanError(msg) {
  const errorMap = {
    'Invalid login credentials': '이메일 또는 비밀번호가 올바르지 않습니다',
    'Email not confirmed': '이메일 인증이 필요합니다. 가입된 이메일을 확인해주세요',
    'User already registered': '이미 가입된 이메일입니다',
    'Password should be at least 6 characters': '비밀번호는 6자 이상이어야 합니다',
    'Invalid email': '올바른 이메일 주소를 입력해주세요',
    'Signup requires a valid password': '올바른 비밀번호를 입력해주세요'
  };

  return errorMap[msg] || msg;
}

// 에러 표시
function showError(message) {
  const errorEl = document.getElementById('error-message');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
}

// 로그인 페이지 초기화
async function initLoginPage() {
  // 쿼리 파라미터에서 에러 처리
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  if (error) {
    showError(decodeURIComponent(error));
  }

  // 회원가입/로그인 모드 상태 (최상단 선언)
  let isSignupMode = false;

  // 소셜 로그인 버튼
  document.getElementById('btn-kakao').addEventListener('click', signInWithKakao);
  document.getElementById('btn-google').addEventListener('click', signInWithGoogle);

  // 이메일 폼 제출 (로그인 / 회원가입 공용)
  const emailForm = document.getElementById('email-form');
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showError('이메일과 비밀번호를 모두 입력해주세요');
      return;
    }

    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = isSignupMode ? '가입 중...' : '로그인 중...';

    if (isSignupMode) {
      await signUpWithEmail(email, password);
    } else {
      await signInWithEmail(email, password);
    }

    btn.disabled = false;
    btn.textContent = isSignupMode ? '회원가입' : '로그인';
  });

  // 회원가입 — 폼 모드 전환 (prompt() 대신)
  const submitBtn = document.getElementById('btn-submit');
  const signupLink = document.getElementById('btn-signup');

  signupLink.addEventListener('click', (e) => {
    e.preventDefault();
    isSignupMode = !isSignupMode;
    submitBtn.textContent = isSignupMode ? '회원가입' : '로그인';
    signupLink.textContent = isSignupMode ? '로그인으로 돌아가기' : '회원가입';
  });

  // 이미 로그인되어 있는지 비동기 체크 (이벤트 리스너 설정 후 백그라운드에서)
  setTimeout(async () => {
    try {
      const sb = await initSupabase();
      if (!sb) return;
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const returnUrl = params.get('returnUrl');
        location.href = returnUrl ? decodeURIComponent(returnUrl) : '/index.html';
      }
    } catch (e) { /* 세션 체크 실패 무시 */ }
  }, 0);
}

// 메인 페이지 초기화 (로그아웃 버튼 등)
async function initMainPage() {
  // 로그아웃 버튼 추가
  const header = document.querySelector('.landing-header');
  if (header) {
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'logout-btn';
    logoutBtn.textContent = '로그아웃';
    logoutBtn.setAttribute('aria-label', '로그아웃');
    header.appendChild(logoutBtn);

    logoutBtn.addEventListener('click', signOut);
  }
}

// 페이지별 초기화
document.addEventListener('DOMContentLoaded', async () => {
  const path = location.pathname;
  console.log('[auth] path:', path, '| supabase CDN:', typeof window.supabase);

  if (path.includes('login')) {
    try {
      await initLoginPage();
      console.log('[auth] initLoginPage 완료');
    } catch (err) {
      console.error('[auth] initLoginPage 실패:', err);
      const form = document.getElementById('email-form');
      if (form) form.addEventListener('submit', e => e.preventDefault());
    }
  } else if (path.includes('index.html') || path === '/') {
    await initMainPage();
    const loggedIn = await requireLogin();
    if (loggedIn && typeof window.loadPersonas === 'function') {
      window.loadPersonas();
    }
  } else if (path.includes('chat')) {
    await requireLogin();
  }
});

// 전역 노출 (chat.js 등에서 사용)
window.supabaseAuth = {
  init: initSupabase,
  requireLogin,
  getToken,
  signInWithKakao,
  signInWithGoogle,
  signInWithEmail,
  signUpWithEmail,
  signOut,
  user: () => user
};
