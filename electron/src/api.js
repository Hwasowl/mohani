// 백엔드 + 로컬 데몬 HTTP 클라이언트.
const AGENT_PORTS = [24555, 24556, 24557];

// dev/prod 환경별 localStorage 키 분리 — 두 환경의 세션·deviceId·활성팀이 섞이지 않게.
// PROD JWT는 dev 백엔드의 시크릿으로는 검증 못 하므로 401이 떨어지는데, 키가 분리되어 있으면 충돌이 안 남.
export function envKey(name) {
  return import.meta.env.PROD ? name : `${name}.dev`;
}

const STORAGE_KEY = envKey('mohani.session');

// 자동 정리: 환경별로 stale localStorage 항목 제거.
// - DEV: 'mohani.backendUrl'은 DEV에서 안 쓰는 키 (baked = .env.development의 localhost).
//        잔재가 남아있으면 PROD↔DEV 전환 시 혼란만 일으키므로 항상 청소.
// - PROD: 과거 cloudflared 임시 URL은 더 이상 유효하지 않으니 청소.
if (typeof window !== 'undefined' && window.localStorage) {
  if (import.meta.env.DEV) {
    if (localStorage.getItem('mohani.backendUrl') !== null) {
      localStorage.removeItem('mohani.backendUrl');
    }
  } else {
    const stored = localStorage.getItem('mohani.backendUrl');
    if (stored && stored.includes('trycloudflare.com')) {
      localStorage.removeItem('mohani.backendUrl');
    }
  }
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
  // DEV: baked URL이 항상 우선 (localStorage 무시) — 로컬 개발 환경을 깨끗하게 유지.
  //      .env.development 에 의해 baked = http://localhost:8080
  // PROD: 사용자 설정(localStorage) > baked URL > 8080
  //       .env.production 에 의해 baked = https://mohani.onrender.com
  if (import.meta.env.PROD) {
    const stored = localStorage.getItem('mohani.backendUrl');
    if (stored) return stored;
  }
  // 직접 접근(optional chaining 없이) — Vite의 정적 치환 정규식이 ?. 가 끼면 못 매칭함.
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

// 로컬 데몬 (포트 폴백)
export async function getAgentState() {
  for (const port of AGENT_PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/state`, { cache: 'no-store' });
      if (r.ok) return { port, state: await r.json() };
    } catch {}
  }
  return null;
}

export async function setAgentPrivacy(isPrivate) {
  for (const port of AGENT_PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/state/privacy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isPrivate }),
      });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

// 로그인 후 데몬이 토큰을 모르면 hook 이벤트를 백엔드로 못 보낸다 — 즉시 동기화한다.
export async function pushAgentSession({ token, userId, displayName }) {
  const backendUrl = getBackendUrl();
  for (const port of AGENT_PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/state/session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, userId, displayName, backendUrl }),
      });
      if (r.ok) return await r.json();
    } catch {}
  }
  return null;
}

export function generateDeviceId() {
  return crypto.randomUUID();
}
