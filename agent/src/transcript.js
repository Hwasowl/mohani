// Claude Code transcript JSONL을 읽어 마지막 assistant turn의 token usage를 가져온다.
// 형식: 각 줄이 message JSON. assistant 메시지는 message.usage.input_tokens / output_tokens 보유.
// 정확한 청구 토큰을 가져오기 위해 추정(char/4) 대신 사용.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';

// 마지막 1MB만 읽어 가장 최근 assistant message의 usage를 추출.
// transcript는 보통 수십~수백KB지만 장기 세션은 MB 넘을 수 있어 cap.
const MAX_READ_BYTES = 1024 * 1024;

export function readLastAssistantUsage(transcriptPath) {
  if (!transcriptPath || typeof transcriptPath !== 'string') return null;
  let raw;
  try {
    const stat = statSync(transcriptPath);
    if (stat.size === 0) return null;
    if (stat.size <= MAX_READ_BYTES) {
      raw = readFileSync(transcriptPath, 'utf8');
    } else {
      // 큰 파일은 끝부분만 읽기
      const fd = openSync(transcriptPath, 'r');
      try {
        const buf = Buffer.alloc(MAX_READ_BYTES);
        readSync(fd, buf, 0, MAX_READ_BYTES, stat.size - MAX_READ_BYTES);
        raw = buf.toString('utf8');
        // 첫 줄은 잘렸을 가능성 — 버림
        const firstNl = raw.indexOf('\n');
        if (firstNl > 0) raw = raw.slice(firstNl + 1);
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    return null;
  }

  return parseLastAssistantUsage(raw);
}

// 순수 함수 — 테스트 용이성. raw JSONL 텍스트에서 마지막 assistant usage를 찾는다.
export function parseLastAssistantUsage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const usage = obj?.message?.usage ?? obj?.usage ?? null;
    const isAssistant =
      obj?.type === 'assistant' ||
      obj?.role === 'assistant' ||
      obj?.message?.role === 'assistant';
    if (isAssistant && usage) {
      const input = Number(usage.input_tokens ?? 0);
      const output = Number(usage.output_tokens ?? 0);
      const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0);
      const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
      // 청구 기준: input + output + cache_creation. cache_read는 별도 할인 요금이지만
      // "사용한 양"이라는 관점에서 합산한다 — 단순화.
      return {
        input,
        output,
        cacheCreate,
        cacheRead,
        total: input + output + cacheCreate + cacheRead,
      };
    }
  }
  return null;
}
