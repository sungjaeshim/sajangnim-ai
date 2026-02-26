// Supabase Auth 모듈
let supabase = null;
let user = null;

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
      user = session?.user || null;

      if (event === 'SIGNED_IN') {
        // 이미 인증 페이지에 있지 않다면 홈으로 이동
        if (!location.pathname.includes('login.html')) {
          // 현재 페이지 유지
        }
      } else if (event === 'SIGNED_OUT') {
        location.href = '/login.html';
      }
    });

    // 현재 세션 확인
    const { data: { session } } = await supabase.auth.getSession();
    user = session?.user || null;

    return supabase;
  } catch (err) {
    console.error('Supabase 초기화 실패:', err);
    return null;
  }
}

// 인증 가드 - 로그인이 필요한 페이지
async function requireLogin() {
  const sb = await initSupabase();
  if (!sb) {
    // 초기화 실패 → 무조건 로그인 페이지로
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?returnUrl=${returnUrl}&error=${encodeURIComponent('초기화 실패. 다시 시도해주세요.')}`;
    return false;
  }

  // getSession에 타임아웃 적용 (3초)
  let session = null;
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000));
    const result = await Promise.race([sb.auth.getSession(), timeout]);
    session = result?.data?.session || null;
  } catch {
    // 타임아웃 or 에러 → 로그인 페이지로
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?returnUrl=${returnUrl}`;
    return false;
  }

  if (!session) {
    // 현재 경로 저장 (로그인 후 복귀용)
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?returnUrl=${returnUrl}`;
    return false;
  }

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

  // 소셜 로그인 버튼
  document.getElementById('btn-kakao').addEventListener('click', signInWithKakao);
  document.getElementById('btn-google').addEventListener('click', signInWithGoogle);

  // 이메일 폼 제출
  const emailForm = document.getElementById('email-form');
  emailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      showError('이메일과 비밀번호를 모두 입력해주세요');
      return;
    }

    const submitBtn = document.getElementById('btn-submit');
    submitBtn.disabled = true;
    submitBtn.textContent = '로그인 중...';

    await signInWithEmail(email, password);

    submitBtn.disabled = false;
    submitBtn.textContent = '로그인';
  });

  // 회원가입 (간단한 프롬프트)
  document.getElementById('btn-signup').addEventListener('click', (e) => {
    e.preventDefault();
    const email = prompt('가입할 이메일 주소를 입력해주세요:');
    if (!email) return;

    const password = prompt('비밀번호를 입력해주세요 (6자 이상):');
    if (!password) return;

    signUpWithEmail(email.trim(), password);
  });

  // 이미 로그인되어 있으면 홈으로
  const sb = await initSupabase();
  if (sb) {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      const returnUrl = params.get('returnUrl');
      location.href = returnUrl ? decodeURIComponent(returnUrl) : '/index.html';
    }
  }
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
  const sb = await initSupabase();

  if (location.pathname.includes('login.html')) {
    await initLoginPage();
  } else if (location.pathname.includes('index.html') || location.pathname === '/') {
    await initMainPage();
    const loggedIn = await requireLogin();
    if (loggedIn && typeof window.loadPersonas === 'function') {
      window.loadPersonas();
    }
  } else if (location.pathname.includes('chat.html')) {
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
