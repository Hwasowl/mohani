// 얇은 백엔드 HTTP 클라이언트. 데몬과 CLI가 공유.
const TIMEOUT_MS = 5000;

async function postJson(url, body, token) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  } finally {
    clearTimeout(t);
  }
}

export async function loginAnonymous(backendUrl, deviceId, displayName) {
  return postJson(`${backendUrl}/api/v1/auth/anonymous`, { deviceId, displayName });
}

export async function createTeam(backendUrl, token, name) {
  return postJson(`${backendUrl}/api/v1/teams`, { name }, token);
}

export async function joinTeam(backendUrl, token, teamCode) {
  return postJson(`${backendUrl}/api/v1/teams/join`, { teamCode }, token);
}

export async function ingestEvent(backendUrl, token, event) {
  return postJson(`${backendUrl}/api/v1/agent/events`, event, token);
}
