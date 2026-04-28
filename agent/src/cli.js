#!/usr/bin/env node
// mohani CLI — login/team 관리 + 데몬 시작/상태.
import { existsSync, readFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureDeviceId, load, save } from './config-store.js';
import { createTeam, joinTeam, loginAnonymous } from './backend-client.js';

const CMDS = {
  status, login, team, privacy, hooks, help,
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
  mohani hooks install                           ~/.claude/settings.json에 mohani hook 등록 (백업 후 머지)
  mohani hooks status                            현재 등록된 mohani hook 개수 확인
  mohani hooks uninstall                         mohani hook만 제거 (다른 hook 보존)
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

async function hooks(rest) {
  const sub = rest[0] || 'status';
  const { installToSettings, uninstallFromSettings, defaultSettingsPath } = await import('./install-fs.js');
  const { countMohaniHooks } = await import('./install-utils.js');

  if (sub === 'install') {
    // 이 cli.js 옆의 hook-cli.js를 절대경로로 등록 → 글로벌/dev 모두 동일하게 작동
    const hookCliPath = fileURLToPath(new URL('./hook-cli.js', import.meta.url));
    const commandPrefix = `node "${hookCliPath}"`;
    const r = installToSettings({ commandPrefix });
    console.log(`mohani: hook ${r.mode} → ${r.path}`);
    if (r.backupPath) console.log(`mohani: backup → ${r.backupPath}`);
    console.log('mohani: 데몬을 켠 채로 (npm start 또는 mohani-agent) Claude Code 새 세션 시작 — 첫 프롬프트가 흘러갑니다');
    return;
  }
  if (sub === 'uninstall') {
    const r = uninstallFromSettings();
    console.log(`mohani: hook ${r.mode} → ${r.path}`);
    if (r.backupPath) console.log(`mohani: backup → ${r.backupPath}`);
    return;
  }
  if (sub === 'status') {
    const path = defaultSettingsPath();
    if (!existsSync(path)) {
      console.log(`mohani: settings.json 없음 (${path}) — \`mohani hooks install\` 먼저 실행하세요`);
      return;
    }
    let settings = {};
    try {
      const raw = readFileSync(path, 'utf8');
      settings = raw.trim() ? JSON.parse(raw) : {};
    } catch (err) {
      throw new Error(`settings.json 파싱 실패: ${err.message}`);
    }
    const n = countMohaniHooks(settings);
    console.log(`mohani: ${n} hook(s) registered at ${path}`);
    if (n === 0) console.log('mohani: `mohani hooks install` 로 등록하세요');
    return;
  }
  throw new Error('usage: mohani hooks install|uninstall|status');
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

const isMain = argv[1] && import.meta.url === pathToFileURL(argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    exit(1);
  });
}
