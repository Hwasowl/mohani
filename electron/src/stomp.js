import { Client } from '@stomp/stompjs';
import { getBackendUrl } from './api.js';

export function createTeamClient({ token, teamCode, onMessage, onConnect, onDisconnect }) {
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
      onConnect?.();
    },
    onWebSocketClose: () => onDisconnect?.(),
  });
  client.activate();
  return () => client.deactivate();
}
