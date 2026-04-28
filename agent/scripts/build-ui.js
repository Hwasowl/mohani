#!/usr/bin/env node
// Electron renderer를 빌드하고 dist/를 agent/ui/로 복사한다.
// publish 전에 prepublishOnly로 자동 실행됨.
//
// 환경변수 VITE_MOHANI_BACKEND_URL 로 prod 백엔드 URL을 주입하면
// 친구가 설치 후 별도 설정 없이 바로 연결됨.
//
// 예: VITE_MOHANI_BACKEND_URL=https://x.trycloudflare.com npm run build:ui
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentDir = resolve(__dirname, '..');
const electronDir = resolve(agentDir, '..', 'electron');
const uiTarget = resolve(agentDir, 'ui');

if (!existsSync(electronDir)) {
  console.error(`[build-ui] electron 폴더를 찾을 수 없음: ${electronDir}`);
  console.error('[build-ui] 이 스크립트는 monorepo 안에서만 실행 가능합니다.');
  process.exit(1);
}

console.log(`[build-ui] backend URL: ${process.env.VITE_MOHANI_BACKEND_URL || '(default localhost:8080)'}`);
console.log('[build-ui] electron renderer 빌드 중...');
execSync('npm run build', { cwd: electronDir, stdio: 'inherit' });

console.log(`[build-ui] dist → ${uiTarget}`);
if (existsSync(uiTarget)) rmSync(uiTarget, { recursive: true, force: true });
cpSync(resolve(electronDir, 'dist'), uiTarget, { recursive: true });

console.log('[build-ui] 완료');
