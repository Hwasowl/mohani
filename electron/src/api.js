// 백엔드 + 로컬 데몬 HTTP 클라이언트.
const AGENT_PORTS = [24555, 24556, 24557];
const STORAGE_KEY = 'mohani.session';

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
  return localStorage.getItem('mohani.backendUrl') || 'http://localhost:8080';
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
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

async function getJson(url, token) {
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
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

export function generateDeviceId() {
  return crypto.randomUUID();
}
