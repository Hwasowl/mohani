// 데몬에서 호출 — 정규화된 이벤트를 백엔드로 송신. 실패 시 인메모리 큐(50건 한도) 재시도.
import { ingestEvent } from './backend-client.js';

const MAX_QUEUE = 50;
const RETRY_INTERVAL_MS = 5000;

export function createTransport({ getConfig, log = console }) {
  const queue = [];
  let timer = null;

  function enqueueDrop(payload) {
    queue.push(payload);
    while (queue.length > MAX_QUEUE) queue.shift(); // 가장 오래된 것 버림
  }

  async function sendOne(payload) {
    const cfg = getConfig();
    if (!cfg.token || !cfg.backendUrl) throw new Error('not authenticated');
    return ingestEvent(cfg.backendUrl, cfg.token, payload);
  }

  async function drain() {
    while (queue.length > 0) {
      const head = queue[0];
      try {
        await sendOne(head);
        queue.shift();
      } catch (err) {
        // 401 → 토큰 무효, drop & give up
        if (err.status === 401) {
          queue.shift();
          log.warn?.('[mohani] 401 — token invalid, dropping queued event');
          continue;
        }
        return false; // 네트워크 오류 — 다음 주기에 재시도
      }
    }
    return true;
  }

  function scheduleDrain() {
    if (timer || queue.length === 0) return;
    timer = setTimeout(async () => {
      timer = null;
      const drained = await drain();
      if (!drained) scheduleDrain();
    }, RETRY_INTERVAL_MS);
  }

  return {
    async send(eventPayload) {
      try {
        await sendOne(toBackendDto(eventPayload));
        return { ok: true };
      } catch (err) {
        if (err.status === 401) {
          log.warn?.('[mohani] 401 — not sending');
          return { ok: false, reason: 'unauthorized' };
        }
        if (err.message === 'not authenticated') {
          return { ok: false, reason: 'not_authenticated' };
        }
        enqueueDrop(toBackendDto(eventPayload));
        scheduleDrain();
        return { ok: false, reason: 'queued', queueDepth: queue.length };
      }
    },
    queueDepth: () => queue.length,
    _drain: drain, // 테스트용
  };
}

// daemon이 onEvent로 넘기는 normalized 형태 → 백엔드 DTO 변환
export function toBackendDto(normalized) {
  return {
    event: normalized.event,
    sessionId: normalized.sessionId,
    cwd: normalized.cwd,
    promptFirstLine: normalized.promptFirstLine ?? null,
    promptFull: normalized.promptFull ?? null,
    assistantPreview: normalized.assistantPreview ?? null,
    assistantFull: normalized.assistantFull ?? null,
    toolUseCount: normalized.toolUseCount ?? null,
    toolName: normalized.toolName ?? null,
    totalTokens: normalized.totalTokens ?? null,
    durationDeltaSec: normalized.durationDeltaSec ?? null,
    cliKind: normalized.cliKind ?? null,
    occurredAt: normalized.occurredAt,
  };
}
