#!/usr/bin/env node
// mohani CLI — login/team 관리 + 데몬 시작/상태.
import { argv, env, exit } from 'node:process';
import { ensureDeviceId, load, save } from './config-store.js';
import { createTeam, joinTeam, loginAnonymous } from './backend-client.js';

const CMDS = {
  status, login, team, privacy, help,
};

async function main() {
  const [cmd, ...rest] = argv.slice(2);
  const fn = CMDS[cmd];
  if (!fn) {
    help();
    exit(cmd ? 1 : 0);
  }
  try {
    await fn(rest);
  } catch (err) {
    console.error(`mohani: ${err.message}`);
    exit(1);
  }
}

function help() {
  console.log(`mohani — AI CLI 활동을 친구에게 공유

사용법:
  mohani login [--name=닉네임] [--backend=URL]   익명 가입 + 토큰 저장
  mohani team create <팀이름>                    팀 생성 → 6자리 코드 출력
  mohani team join <팀코드>                      팀 가입
  mohani privacy on|off                          비공개 모드 토글
  mohani status                                  현재 설정/로그인 상태

환경변수:
  MOHANI_BACKEND_URL   기본 backend URL (default: http://localhost:8080)
`);
}

function parseFlag(rest, name, def = null) {
  for (const a of rest) {
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return def;
}

async function login(rest) {
  const cfg = ensureDeviceId(load());
  const backend = parseFlag(rest, 'backend', env.MOHANI_BACKEND_URL || cfg.backendUrl);
  const name = parseFlag(rest, 'name', cfg.displayName || `user-${cfg.deviceId.slice(0, 6)}`);

  const result = await loginAnonymous(backend, cfg.deviceId, name);
  const next = {
    ...cfg,
    backendUrl: backend,
    token: result.token,
    userId: result.userId,
    displayName: result.displayName,
  };
  save(next);
  console.log(`mohani: logged in as ${result.displayName} (userId=${result.userId})`);
  console.log(`mohani: token saved to ~/.mohani/config.json`);
}

async function team(rest) {
  const sub = rest[0];
  const cfg = load();
  if (!cfg.token) throw new Error('login first: mohani login');

  if (sub === 'create') {
    const name = rest.slice(1).join(' ').trim();
    if (!name) throw new Error('usage: mohani team create <name>');
    const t = await createTeam(cfg.backendUrl, cfg.token, name);
    console.log(`mohani: team "${t.name}" created`);
    console.log(`        team code: ${t.teamCode}    (친구한테 공유)`);
    return;
  }
  if (sub === 'join') {
    const code = (rest[1] || '').trim().toUpperCase();
    if (!code) throw new Error('usage: mohani team join <code>');
    const t = await joinTeam(cfg.backendUrl, cfg.token, code);
    console.log(`mohani: joined team "${t.name}" (${t.teamCode})`);
    return;
  }
  throw new Error('usage: mohani team create|join ...');
}

async function privacy(rest) {
  const cfg = load();
  const mode = rest[0];
  if (mode !== 'on' && mode !== 'off') throw new Error('usage: mohani privacy on|off');
  cfg.isPrivate = mode === 'on';
  save(cfg);
  console.log(`mohani: privacy ${mode}`);
}

async function status() {
  const cfg = load();
  console.log(JSON.stringify({
    backendUrl: cfg.backendUrl,
    loggedIn: Boolean(cfg.token),
    userId: cfg.userId,
    displayName: cfg.displayName,
    deviceId: cfg.deviceId ? `${cfg.deviceId.slice(0, 8)}...` : null,
    isPrivate: cfg.isPrivate,
    blacklistedDirs: cfg.blacklistedDirs,
  }, null, 2));
}

const isMain = import.meta.url === `file://${argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
