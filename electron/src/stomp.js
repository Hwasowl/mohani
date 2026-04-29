import { Client } from '@stomp/stompjs';
import { getBackendUrl } from './api.js';

// 팀 활동 피드(/topic/team/{code}) + 팀 채팅(/topic/team/{code}/chat) 모두 한 연결로.
export function createTeamClient({ token, teamCode, onMessage, onChat, onConnect, onDisconnect }) {
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
      onConnect?.();
    },
    onWebSocketClose: () => onDisconnect?.(),
  });
  client.activate();

  return {
    sendChat(text) {
      if (!client.connected) return false;
      const trimmed = (text ?? '').trim();
      if (!trimmed) return false;
      client.publish({
        destination: `/app/team/${teamCode}/chat`,
        body: JSON.stringify({ text: trimmed }),
      });
      return true;
    },
    disconnect() { client.deactivate(); },
  };
}
