// Supabase Auth 모듈 — 재설계 by Opus
// 핵심: detectSessionInUrl:true로 Supabase가 OAuth hash를 자동 처리
let supabase = null;
let _initPromise = null; // 레이스컨디션 방지
let user = null;

const SESSION_KEY = 'sb-xczegfsgxlnsvsmmrgaz-auth-token';

// Supabase 초기화 (싱글턴 + Promise 레이스 방지)
async function initSupabase() {
  if (supabase) return supabase;
  if (_initPromise) return _initPromise; // 이미 초기화 중이면 같은 Promise 공유
  _initPromise = _doInitSupabase();
  return _initPromise;
}

async function _doInitSupabase() {

  if (typeof window.supabase === 'undefined' || typeof window.supabase.createClient !== 'function') {
    console.error('[auth] Supabase CDN 미로드');
    return null;
  }

  const config = await fetch('/api/config').then(r => {
    if (!r.ok) throw new Error('config fetch failed');
    return r.json();
  });

  supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      detectSessionInUrl: true,   // Supabase가 #access_token 자동 처리
      persistSession: true,
      storageKey: SESSION_KEY
    }
  });

  supabase.auth.onAuthStateChange((event, session) => {
    console.log('[auth] state:', event, !!session);
    user = session?.user || null;

    // OAuth 콜백 완료 후 hash 제거
    if (event === 'SIGNED_IN' && location.hash.includes('access_token')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  });

  return supabase;
}

// 인증 가드 — 세션 없으면 login.html redirect
// chat.js는 직접 window.supabaseAuth.requireLogin() 호출 — auth.js DOMContentLoaded에서 중복 호출 안 함
async function requireLogin() {
  const sb = await initSupabase();
  if (!sb) {
    redirectToLogin();
    return false;
  }

  // getSession()이 hash 파싱 + localStorage 복원 모두 처리
  const { data: { session }, error } = await sb.auth.getSession();

  if (error || !session) {
    redirectToLogin();
    return false;
  }

  user = session.user;
  window._authReady = true;
  return true;
}

function redirectToLogin() {
  // OAuth 콜백 중이면 redirect 금지
  if ((location.hash || '').includes('access_token')) return;
  const ret = encodeURIComponent(location.pathname + location.search);
  location.replace('/login.html?returnUrl=' + ret);
}

// 현재 토큰 반환
async function getToken() {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

// 구글 로그인
async function signInWithGoogle() {
  const sb = await initSupabase();
  if (!sb) return showError('구글 로그인을 할 수 없습니다');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: location.origin + '/index.html', queryParams: { prompt: 'select_account' } }
  });
  if (error) showError('구글 로그인 실패: ' + error.message);
}

// 카카오 로그인
async function signInWithKakao() {
  const sb = await initSupabase();
  if (!sb) return showError('카카오 로그인을 할 수 없습니다');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: location.origin + '/index.html', queryParams: { prompt: 'select_account' } }
  });
  if (error) showError('카카오 로그인 실패: ' + error.message);
}

// 이메일 로그인
async function signInWithEmail(email, password) {
  const sb = await initSupabase();
  if (!sb) { showError('로그인 불가'); return false; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showError('로그인 실패: ' + getKoreanError(error.message)); return false; }
  const returnUrl = new URLSearchParams(location.search).get('returnUrl');
  location.href = returnUrl ? decodeURIComponent(returnUrl) : '/index.html';
  return true;
}

// 이메일 회원가입
async function signUpWithEmail(email, password) {
  const sb = await initSupabase();
  if (!sb) { showError('회원가입 불가'); return false; }
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: location.origin + '/login.html' }
  });
  if (error) { showError('회원가입 실패: ' + getKoreanError(error.message)); return false; }
  if (data.user && !data.session) {
    showError('인증 링크가 발송되었습니다. 이메일을 확인해주세요.');
    return true;
  }
  const returnUrl = new URLSearchParams(location.search).get('returnUrl');
  location.href = returnUrl ? decodeURIComponent(returnUrl) : '/index.html';
  return true;
}

// 로그아웃
async function signOut() {
  if (supabase) { try { await supabase.auth.signOut(); } catch (e) {} }
  localStorage.removeItem(SESSION_KEY);
  location.href = '/login.html';
}

// 에러 한글화
function getKoreanError(msg) {
  return ({
    'Invalid login credentials': '이메일 또는 비밀번호가 올바르지 않습니다',
    'Email not confirmed': '이메일 인증이 필요합니다',
    'User already registered': '이미 가입된 이메일입니다',
    'Password should be at least 6 characters': '비밀번호는 6자 이상이어야 합니다',
    'Invalid email': '올바른 이메일 주소를 입력해주세요',
    'Signup requires a valid password': '올바른 비밀번호를 입력해주세요'
  })[msg] || msg;
}

function showError(message) {
  const el = document.getElementById('error-message');
  if (el) { el.textContent = message; el.classList.add('show'); }
}

// 로그인 페이지 초기화
async function initLoginPage() {
  const params = new URLSearchParams(location.search);
  const error = params.get('error');
  if (error) showError(decodeURIComponent(error));

  let isSignupMode = false;

  document.getElementById('btn-kakao').addEventListener('click', signInWithKakao);
  document.getElementById('btn-google').addEventListener('click', signInWithGoogle);

  const emailForm = document.getElementById('email-form');
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    if (!email || !password) { showError('이메일과 비밀번호를 모두 입력해주세요'); return; }
    const btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = isSignupMode ? '가입 중...' : '로그인 중...';
    isSignupMode ? await signUpWithEmail(email, password) : await signInWithEmail(email, password);
    btn.disabled = false;
    btn.textContent = isSignupMode ? '회원가입' : '로그인';
  });

  const submitBtn = document.getElementById('btn-submit');
  const signupLink = document.getElementById('btn-signup');
  signupLink.addEventListener('click', (e) => {
    e.preventDefault();
    isSignupMode = !isSignupMode;
    submitBtn.textContent = isSignupMode ? '회원가입' : '로그인';
    signupLink.textContent = isSignupMode ? '로그인으로 돌아가기' : '회원가입';
  });

  // 이미 로그인 상태면 redirect
  try {
    const sb = await initSupabase();
    if (sb) {
      const { data: { session } } = await sb.auth.getSession();
      if (session) {
        const returnUrl = params.get('returnUrl');
        location.href = returnUrl ? decodeURIComponent(returnUrl) : '/index.html';
      }
    }
  } catch (e) {}
}

// 메인 페이지 초기화
async function initMainPage() {
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
  console.log('[auth] page:', path);

  if (path.includes('login')) {
    try { await initLoginPage(); } catch (err) {
      console.error('[auth] initLoginPage 실패:', err);
    }
  } else if (path.includes('index') || path === '/') {
    await initMainPage();
    const loggedIn = await requireLogin();
    if (loggedIn && typeof window.loadPersonas === 'function') window.loadPersonas();
  }
  // chat 페이지: chat.js가 직접 requireLogin() 처리 — 여기서 중복 호출 금지
});

// 전역 노출
window.supabaseAuth = {
  init: initSupabase, requireLogin, getToken,
  signInWithKakao, signInWithGoogle, signInWithEmail, signUpWithEmail, signOut,
  user: () => user
};
