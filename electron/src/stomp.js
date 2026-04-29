import { Client } from '@stomp/stompjs';
import { getBackendUrl } from './api.js';

// 팀 활동 피드(/topic/team/{code}) + 팀 채팅(/topic/team/{code}/chat) +
// 타이핑 인디케이터(/topic/team/{code}/chat/typing) — 모두 한 연결로.
export function createTeamClient({ token, teamCode, onMessage, onChat, onTyping, onConnect, onDisconnect }) {
  const url = getBackendUrl().replace(/^http/, 'ws') + '/ws';
  const client = new Client({
    brokerURL: url,
    connectHeaders: { Authorization: `Bearer ${token}` },
    reconnectDelay: 3000,
    debug: () => {},
    onConnect: () => {
      client.subscribe(`/topic/team/${teamCode}`, (frame) => {
        try { onMessage?.(JSON.parse(frame.body)); } catch {}
      });
      client.subscribe(`/topic/team/${teamCode}/chat`, (frame) => {
        try { onChat?.(JSON.parse(frame.body)); } catch {}
      });
      client.subscribe(`/topic/team/${teamCode}/chat/typing`, (frame) => {
        try { onTyping?.(JSON.parse(frame.body)); } catch {}
      });
      onConnect?.();
    },
    onWebSocketClose: () => onDisconnect?.(),
  });
  client.activate();

  // 타이핑 SEND를 너무 자주 보내지 않게 throttle — 마지막 송신 후 2초 동안 추가 송신 안 함
  let lastTypingAt = 0;

  return {
    // text 또는 imageUrl 중 하나 이상 있으면 송신.
    sendChat({ text, imageUrl } = {}) {
      if (!client.connected) return false;
      const t = (text ?? '').trim();
      const u = (imageUrl ?? '').trim();
      if (!t && !u) return false;
      client.publish({
        destination: `/app/team/${teamCode}/chat`,
        body: JSON.stringify({ text: t || null, imageUrl: u || null }),
      });
      return true;
    },
    sendTyping() {
      if (!client.connected) return false;
      const now = Date.now();
      if (now - lastTypingAt < 2000) return false; // throttle
      lastTypingAt = now;
      client.publish({ destination: `/app/team/${teamCode}/chat/typing`, body: '' });
      return true;
    },
    disconnect() { client.deactivate(); },
  };
}
