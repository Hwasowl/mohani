// 백엔드 + 로컬 데몬 HTTP 클라이언트.
// dev Electron → 24565 (dev 데몬), prod Electron → 24555 (글로벌 mohani 데몬). 단일 포트.
const AGENT_PORT = import.meta.env.DEV ? 24565 : 24555;

// H1: 데몬 호출 시 Authorization: Bearer <localSecret> 필요.
// preload IPC로 한 번 받아서 캐시. Electron 환경 외(Vite 단독 실행)에선 null → 데몬 401.
let cachedLocalSecret = null;
let localSecretLoad = null;
async function getLocalSecret() {
  if (cachedLocalSecret) return cachedLocalSecret;
  if (typeof window === 'undefined' || !window.mohaniIpc?.getLocalSecret) return null;
  if (!localSecretLoad) {
    localSecretLoad = window.mohaniIpc.getLocalSecret().then((s) => {
      cachedLocalSecret = s;
      return s;
    }).catch(() => null);
  }
  return localSecretLoad;
}

// dev/prod 환경별 localStorage 키 분리 — 두 환경의 세션·deviceId·활성팀이 섞이지 않게.
// PROD JWT는 dev 백엔드의 시크릿으로는 검증 못 하므로 401이 떨어지는데, 키가 분리되어 있으면 충돌이 안 남.
export function envKey(name) {
  return import.meta.env.PROD ? name : `${name}.dev`;
}

const STORAGE_KEY = envKey('mohani.session');

// 진단 로그 — 어떤 버전의 api.js가 로드됐는지 콘솔에서 즉시 확인 가능.
if (typeof window !== 'undefined') {
  // eslint-disable-next-line no-console
  console.log('[mohani api.js v3] mode=', import.meta.env.MODE,
              'baked=', import.meta.env.VITE_MOHANI_BACKEND_URL);
}

export const session = {
  load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    } catch {
      return null;
    }
  },
  save(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  },
  clear() {
    localStorage.removeItem(STORAGE_KEY);
  },
};

export function getBackendUrl() {
  // DEV: baked URL이 무조건 우선. localStorage에 잔재가 있으면 호출 시점마다 청소 — Vite HMR로
  //      모듈 top-level이 재실행 안 되는 상황도 자동 복구된다.
  // PROD: 사용자 설정(localStorage) > baked URL > 8080
  if (import.meta.env.DEV) {
    if (typeof window !== 'undefined' && window.localStorage
        && localStorage.getItem('mohani.backendUrl') !== null) {
      localStorage.removeItem('mohani.backendUrl');
    }
    // 직접 접근(optional chaining 없이) — Vite의 정적 치환 정규식이 ?. 가 끼면 못 매칭함.
    const baked = import.meta.env.VITE_MOHANI_BACKEND_URL;
    return baked || 'http://localhost:8080';
  }
  const stored = localStorage.getItem('mohani.backendUrl');
  if (stored) return stored;
  const baked = import.meta.env.VITE_MOHANI_BACKEND_URL;
  return baked || 'http://localhost:8080';
}

export function setBackendUrl(url) {
  localStorage.setItem('mohani.backendUrl', url);
}

async function postJson(url, body, token) {
  return jsonRequest('POST', url, body, token);
}

async function jsonRequest(method, url, body, token) {
  const res = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function loginAnonymous(deviceId, displayName) {
  return postJson(`${getBackendUrl()}/api/v1/auth/anonymous`, { deviceId, displayName });
}
export async function updateMyDisplayName(token, displayName) {
  return jsonRequest('PATCH', `${getBackendUrl()}/api/v1/auth/me`, { displayName }, token);
}
export async function updateMyAvatar(token, avatarUrl) {
  return jsonRequest('PATCH', `${getBackendUrl()}/api/v1/auth/me/avatar`, { avatarUrl }, token);
}
export async function createTeam(token, name) {
  return postJson(`${getBackendUrl()}/api/v1/teams`, { name }, token);
}
export async function joinTeam(token, teamCode) {
  return postJson(`${getBackendUrl()}/api/v1/teams/join`, { teamCode }, token);
}
export async function listMyTeams(token) {
  return getJson(`${getBackendUrl()}/api/v1/teams/me`, token);
}
export async function listTeamMembers(token, teamId) {
  return getJson(`${getBackendUrl()}/api/v1/teams/${teamId}/members`, token);
}
export async function leaveTeam(token, teamId) {
  return jsonRequest('DELETE', `${getBackendUrl()}/api/v1/teams/${teamId}/leave`, undefined, token);
}
export async function getTeamTodayStats(token, teamId) {
  return getJson(`${getBackendUrl()}/api/v1/teams/${teamId}/today-stats`, token);
}
export async function getRecentActivity(token, teamId, userId, limit = 10) {
  const url = `${getBackendUrl()}/api/v1/activity?teamId=${teamId}&userId=${userId}&limit=${limit}`;
  return getJson(url, token);
}
export async function getTeamFeed(token, teamId, limit = 30) {
  const url = `${getBackendUrl()}/api/v1/activity/team-feed?teamId=${teamId}&limit=${limit}`;
  return getJson(url, token);
}
export async function getLeaderboard(token, teamId, { metric = 'tokens', window = 'today' } = {}) {
  const url = `${getBackendUrl()}/api/v1/teams/${teamId}/leaderboard?metric=${metric}&window=${window}`;
  return getJson(url, token);
}

// 로컬 데몬 (포트 폴백). H1 — 모든 호출에 localSecret 헤더 첨부.
async function agentHeaders(extra = {}) {
  const secret = await getLocalSecret();
  return {
    ...extra,
    ...(secret ? { authorization: `Bearer ${secret}` } : {}),
  };
}

const AGENT_BASE = `http://127.0.0.1:${AGENT_PORT}`;

export async function getAgentState() {
  const headers = await agentHeaders();
  try {
    const r = await fetch(`${AGENT_BASE}/state`, { cache: 'no-store', headers });
    if (!r.ok) return null;
    return { port: AGENT_PORT, state: await r.json() };
  } catch { return null; }
}

export async function setAgentPrivacy(isPrivate) {
  const headers = await agentHeaders({ 'content-type': 'application/json' });
  try {
    const r = await fetch(`${AGENT_BASE}/state/privacy`, {
      method: 'POST', headers, body: JSON.stringify({ isPrivate }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// 본문 숨김 토글 — { hideQuestion?: bool, hideAnswer?: bool } 부분 갱신.
// 데몬에서 영구 저장(~/.mohani/config.json) — 재시작 후에도 유지.
export async function setAgentVisibility(patch) {
  const headers = await agentHeaders({ 'content-type': 'application/json' });
  try {
    const r = await fetch(`${AGENT_BASE}/state/visibility`, {
      method: 'POST', headers, body: JSON.stringify(patch),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// 로그인 후 데몬이 토큰을 모르면 hook 이벤트를 백엔드로 못 보낸다 — 즉시 동기화한다.
export async function pushAgentSession({ token, userId, displayName }) {
  const backendUrl = getBackendUrl();
  const headers = await agentHeaders({ 'content-type': 'application/json' });
  try {
    const r = await fetch(`${AGENT_BASE}/state/session`, {
      method: 'POST', headers, body: JSON.stringify({ token, userId, displayName, backendUrl }),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export function generateDeviceId() {
  return crypto.randomUUID();
}
