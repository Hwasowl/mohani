// 백엔드 + 로컬 데몬 HTTP 클라이언트.
const AGENT_PORTS = [24555, 24556, 24557];
const STORAGE_KEY = 'mohani.session';

// 1회성 마이그레이션: 과거 cloudflared 임시 URL이 localStorage에 박혀 있던 사용자들을
// Render 배포 URL로 강제 이동. 키가 이미 찍혀 있으면 사용자 설정을 존중한다.
const RENDER_URL = 'https://mohani.onrender.com';
const MIGRATION_KEY = 'mohani.migration.render-v1';
if (typeof window !== 'undefined' && window.localStorage) {
  if (!localStorage.getItem(MIGRATION_KEY)) {
    localStorage.removeItem('mohani.backendUrl');
    localStorage.setItem('mohani.backendUrl', RENDER_URL);
    localStorage.setItem(MIGRATION_KEY, '1');
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
  // 우선순위: 사용자 설정(localStorage) > 빌드 시 baked URL(VITE env) > localhost(dev)
  const stored = localStorage.getItem('mohani.backendUrl');
  if (stored) return stored;
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
