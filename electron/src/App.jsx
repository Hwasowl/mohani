import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeam,
  envKey,
  generateDeviceId,
  getAgentState,
  getRecentActivity,
  getTeamFeed,
  getTeamTodayStats,
  joinTeam,
  listMyTeams,
  listTeamMembers,
  leaveTeam,
  loginAnonymous,
  pushAgentSession,
  session,
  setAgentPrivacy,
  setBackendUrl,
  getBackendUrl,
  updateMyAvatar,
  updateMyDisplayName,
} from './api.js';
import { createTeamClient } from './stomp.js';
import { ImgBbError, uploadToImgBb } from './imgbb.js';

const ACTIVE_WINDOW_MS = 90 * 1000;

function useDeviceId() {
  return useMemo(() => {
    const key = envKey('mohani.deviceId');
    let id = localStorage.getItem(key);
    if (!id) {
      id = generateDeviceId();
      localStorage.setItem(key, id);
    }
    return id;
  }, []);
}

function hashHue(seed) {
  const s = (seed ?? '').toString();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function CliBadge({ kind }) {
  if (!kind) return null;
  const label = kind === 'codex' ? 'Codex' : kind === 'aider' ? 'Aider' : 'Claude';
  return <span className={`cli-badge cli-${kind}`}>{label}</span>;
}

function Avatar({ name, seed, size = 40, ring, url }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const hue = hashHue(seed ?? name);
  if (url) {
    return (
      <div
        className={`avatar avatar-image${ring ? ' ring' : ''}`}
        style={{ width: size, height: size }}
      >
        <img src={url} alt={name ?? ''} loading="lazy"
             onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </div>
    );
  }
  return (
    <div
      className={`avatar${ring ? ' ring' : ''}`}
      style={{
        background: `linear-gradient(135deg, hsl(${hue},60%,45%), hsl(${(hue + 40) % 360},55%,35%))`,
        width: size,
        height: size,
        fontSize: Math.round(size * 0.44),
      }}
    >
      {initial}
    </div>
  );
}

export default function App() {
  // URL hash로 메인/위젯/채팅 모드 분기
  if (typeof window !== 'undefined') {
    if (window.location.hash === '#widget') return <WidgetApp />;
    if (window.location.hash === '#chat') return <ChatStandalone />;
  }
  return <MainApp />;
}

function MainApp() {
  const [me, setMe] = useState(session.load());
  const [teams, setTeams] = useState([]);
  const [activeTeam, setActiveTeam] = useState(null);
  const [members, setMembers] = useState([]);
  // 팀 전환 시 활동 히스토리가 사라지지 않도록 teamCode별로 보관
  const [feedByTeam, setFeedByTeam] = useState({});      // { [teamCode]: TeamFeedMessage[] }
  const [activityByTeam, setActivityByTeam] = useState({}); // { [teamCode]: { [userId]: ... } }
  // 팀 진입 후 첫 stats/feed가 도착할 때까지 카드를 스켈레톤으로 — 0 토큰이 잠깐 보이는 어색함 방지
  const [loadingByTeam, setLoadingByTeam] = useState({}); // { [teamCode]: boolean }
  // 팀 채팅은 영구저장 안 함 — 새로고침/팀변경 시 자동 소멸 OK
  const [chatByTeam, setChatByTeam] = useState({});       // { [teamCode]: ChatMessage[] }
  const [unreadByTeam, setUnreadByTeam] = useState({});   // { [teamCode]: number }
  const [chatOpen, setChatOpen] = useState(false);
  // 누가 타이핑 중인지: { [teamCode]: { [userId]: { displayName, expiresAt } } }
  const [typingByTeam, setTypingByTeam] = useState({});
  const teamClientRef = useRef(null);
  const [agentState, setAgentState] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'rename' | 'avatar' | 'team' | 'leave' | null
  const [selectedMember, setSelectedMember] = useState(null);
  // 피드 패널 열림/닫힘 + 너비 — 사용자 선호 영구 저장
  const [feedOpen, setFeedOpen] = useState(() => localStorage.getItem('mohani.feedOpen') !== '0');
  const [feedWidth, setFeedWidth] = useState(() => Number(localStorage.getItem('mohani.feedWidth')) || 320);
  useEffect(() => { localStorage.setItem('mohani.feedOpen', feedOpen ? '1' : '0'); }, [feedOpen]);
  useEffect(() => { localStorage.setItem('mohani.feedWidth', String(feedWidth)); }, [feedWidth]);

  const deviceId = useDeviceId();
  const activeTeamCode = activeTeam?.teamCode;
  const feed = activeTeamCode ? (feedByTeam[activeTeamCode] ?? []) : [];
  const activity = activeTeamCode ? (activityByTeam[activeTeamCode] ?? {}) : {};
  const chat = activeTeamCode ? (chatByTeam[activeTeamCode] ?? []) : [];
  const unreadCount = activeTeamCode ? (unreadByTeam[activeTeamCode] ?? 0) : 0;
  const isLoadingTeam = activeTeamCode ? !!loadingByTeam[activeTeamCode] : false;
  // 활성 타이핑 (5초 이내, 본인 제외) 사용자 displayName 배열
  const typingNames = useMemo(() => {
    if (!activeTeamCode) return [];
    const map = typingByTeam[activeTeamCode] ?? {};
    const now = Date.now();
    return Object.values(map)
      .filter((t) => t.userId !== me?.userId && t.expiresAt > now)
      .map((t) => t.displayName);
  }, [typingByTeam, activeTeamCode, me?.userId]);

  // chatOpen/activeTeamCode을 콜백 안에서 최신값으로 보려면 ref가 필요 — 안 그러면 stale closure
  const chatOpenRef = useRef(chatOpen);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  const activeTeamCodeRef = useRef(activeTeamCode);
  useEffect(() => { activeTeamCodeRef.current = activeTeamCode; }, [activeTeamCode]);

  // 채팅 패널을 열거나 팀을 바꿀 때 해당 팀 미읽음 0으로 리셋
  useEffect(() => {
    if (chatOpen && activeTeamCode && unreadByTeam[activeTeamCode]) {
      setUnreadByTeam((prev) => ({ ...prev, [activeTeamCode]: 0 }));
    }
  }, [chatOpen, activeTeamCode]);

  // 타이핑 만료 정리 — 1초마다 체크해서 expiresAt 지난 항목 제거
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTypingByTeam((prev) => {
        let changed = false;
        const next = {};
        for (const [code, map] of Object.entries(prev)) {
          const filtered = {};
          for (const [uid, t] of Object.entries(map)) {
            if (t.expiresAt > now) filtered[uid] = t;
            else changed = true;
          }
          next[code] = filtered;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // 백엔드 토큰이 만료/무효(예: docker reset으로 user 사라짐) → 자동으로 세션 초기화
  function handleApiError(e) {
    if (e?.status === 401) {
      session.clear();
      setMe(null); setTeams([]); setActiveTeam(null);
      setFeedByTeam({}); setActivityByTeam({}); setMembers([]);
      setError('세션이 만료됐어요. 다시 시작해주세요.');
      return true;
    }
    setError(e.message);
    return false;
  }

  useEffect(() => {
    if (!me) return;
    (async () => {
      try {
        const ts = await listMyTeams(me.token);
        setTeams(ts);
        if (ts.length > 0 && !activeTeam) setActiveTeam(ts[0]);
      } catch (e) { handleApiError(e); }
    })();
  }, [me]);

  useEffect(() => {
    if (!me || !activeTeam) return;
    const teamCode = activeTeam.teamCode;
    // 이미 캐시된 팀이면 로딩 스켈레톤 안 띄움 (전환 시 이전 값 그대로 보여주고 백그라운드 갱신)
    setLoadingByTeam((prev) => prev[teamCode] ? prev : { ...prev, [teamCode]: !activityByTeam[teamCode] });
    (async () => {
      try {
        const [ms, todayStats, feedItems] = await Promise.all([
          listTeamMembers(me.token, activeTeam.id),
          getTeamTodayStats(me.token, activeTeam.id),
          getTeamFeed(me.token, activeTeam.id, 30),
        ]);
        setMembers(ms);
        // 피드에서 사용자별 최근 UserPromptSubmit 첫 줄을 뽑아낸다 — 카드의 마지막 활동 표시용.
        const latestPromptByUser = {};
        for (const it of feedItems) {
          if (it.eventKind === 'UserPromptSubmit' && it.promptFirstLine
              && !latestPromptByUser[it.userId]) {
            latestPromptByUser[it.userId] = {
              promptFirstLine: it.promptFirstLine,
              cliKind: it.cliKind ?? null,
              occurredAt: it.occurredAt,
            };
          }
        }
        // 첫 진입에 토큰/시간/lastSeen + 마지막 프롬프트가 즉시 보이도록 activityByTeam 채움.
        // WSS 메시지가 도착하면 그 위에 덮어써서 실시간 갱신 유지.
        setActivityByTeam((prev) => {
          const existing = prev[teamCode] ?? {};
          const next = { ...existing };
          for (const s of todayStats) {
            const lastSeenMs = s.lastSeen ? Date.parse(s.lastSeen) : null;
            const lp = latestPromptByUser[s.userId];
            next[s.userId] = {
              ...next[s.userId],
              todayTokens: s.todayTokens ?? 0,
              todayDurationSec: s.todayDurationSec ?? 0,
              lastSeen: lastSeenMs ?? next[s.userId]?.lastSeen ?? null,
              // WSS로 더 최신 promptFirstLine을 이미 받았다면 보존, 아니면 피드에서 뽑은 걸 사용
              promptFirstLine: next[s.userId]?.promptFirstLine ?? lp?.promptFirstLine ?? null,
              cliKind: next[s.userId]?.cliKind ?? lp?.cliKind ?? null,
            };
          }
          return { ...prev, [teamCode]: next };
        });
        setLoadingByTeam((prev) => ({ ...prev, [teamCode]: false }));
        // "최근에 뭐 했나" 피드를 DB에서 hydrate — 새로고침해도 사라지지 않음.
        // WSS 메시지로 들어오는 신규 항목은 prepend되어 자연스럽게 누적.
        setFeedByTeam((prev) => {
          // 이미 WSS로 받은 항목과 중복 안 되게 id 기반으로 머지.
          const existing = prev[teamCode] ?? [];
          const existingIds = new Set(existing.map((x) => x.id).filter(Boolean));
          const hydrated = feedItems
            .filter((it) => !existingIds.has(it.id))
            .map((it) => ({
              id: it.id,
              event: it.eventKind,
              eventKind: it.eventKind,
              userId: it.userId,
              displayName: it.displayName,
              avatarUrl: it.avatarUrl,
              promptFirstLine: it.promptFirstLine,
              assistantPreview: it.assistantPreview,
              toolUseCount: it.toolUseCount,
              responseTokens: it.responseTokens,
              cliKind: it.cliKind,
              _ts: Date.parse(it.occurredAt),
            }));
          // 합치고 시간순(최신 먼저) 정렬, 30개로 cap
          const merged = [...existing, ...hydrated]
            .sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0))
            .slice(0, 30);
          return { ...prev, [teamCode]: merged };
        });
      } catch (e) {
        setLoadingByTeam((prev) => ({ ...prev, [teamCode]: false }));
        handleApiError(e);
      }
    })();
  }, [me, activeTeam]);

  useEffect(() => {
    if (!me || !activeTeam) return;
    const teamCode = activeTeam.teamCode;
    const client = createTeamClient({
      token: me.token,
      teamCode,
      onMessage: (msg) => {
        // 피드: UserPromptSubmit은 신규 prepend, Stop(답변 동봉)은 가장 최근의 같은 사용자 미응답 항목 update
        if (msg.event === 'UserPromptSubmit' && msg.promptFirstLine) {
          setFeedByTeam((prev) => {
            const cur = prev[teamCode] ?? [];
            return {
              ...prev,
              [teamCode]: [{ ...msg, eventKind: 'UserPromptSubmit', _ts: Date.now() }, ...cur].slice(0, 30),
            };
          });
        } else if (msg.event === 'Stop' && msg.assistantPreview) {
          setFeedByTeam((prev) => {
            const cur = prev[teamCode] ?? [];
            // 같은 사용자 + cliKind의 가장 최근 미응답 항목 찾기
            const idx = cur.findIndex((f) =>
              f.userId === msg.userId
              && f.cliKind === msg.cliKind
              && !f.assistantPreview
              && f.eventKind === 'UserPromptSubmit');
            if (idx === -1) return prev;
            const next = [...cur];
            next[idx] = {
              ...next[idx],
              assistantPreview: msg.assistantPreview,
              toolUseCount: msg.toolUseCount ?? next[idx].toolUseCount ?? 0,
              responseTokens: msg.responseTokens ?? next[idx].responseTokens ?? 0,
            };
            return { ...prev, [teamCode]: next };
          });
        }
        // 카드의 토큰/시간/현재작업은 모든 이벤트로 갱신
        setActivityByTeam((prev) => {
          const teamMap = prev[teamCode] ?? {};
          return {
            ...prev,
            [teamCode]: {
              ...teamMap,
              [msg.userId]: {
                promptFirstLine: msg.promptFirstLine ?? teamMap[msg.userId]?.promptFirstLine ?? null,
                todayTokens: msg.todayTokens,
                todayDurationSec: msg.todayDurationSec,
                lastSeen: Date.now(),
                event: msg.event,
                toolName: msg.toolName,
                displayName: msg.displayName,
                cliKind: msg.cliKind ?? teamMap[msg.userId]?.cliKind ?? null,
              },
            },
          };
        });
      },
      onTyping: (evt) => {
        // 5초 동안 "입력 중" 으로 표시 — 추가 SEND가 오면 만료시간 갱신
        if (!evt || evt.userId === me.userId) return;
        setTypingByTeam((prev) => {
          const map = prev[teamCode] ?? {};
          return {
            ...prev,
            [teamCode]: {
              ...map,
              [evt.userId]: {
                userId: evt.userId,
                displayName: evt.displayName,
                expiresAt: Date.now() + 5000,
              },
            },
          };
        });
      },
      onChat: (msg) => {
        // 메시지가 도착한 사용자는 더 이상 타이핑 중 아님 — 즉시 정리
        setTypingByTeam((prev) => {
          const map = prev[teamCode];
          if (!map || !map[msg.userId]) return prev;
          const { [msg.userId]: _, ...rest } = map;
          return { ...prev, [teamCode]: rest };
        });
        // 메시지에 안정 키 부여 (sentAt+userId+text도 가능하지만 충돌 가능 — Date.now() 보강)
        const item = { ...msg, _key: `${msg.userId}-${msg.sentAt}-${Math.random().toString(36).slice(2, 6)}` };
        setChatByTeam((prev) => {
          const cur = prev[teamCode] ?? [];
          // 200개 cap (메모리 보호)
          const next = [...cur, item];
          if (next.length > 200) next.splice(0, next.length - 200);
          return { ...prev, [teamCode]: next };
        });
        // 본인이 보낸 게 아니고, 채팅 패널이 닫혀있거나 다른 팀이면 미읽음 +1
        const isMine = msg.userId === me.userId;
        const isVisible = chatOpenRef.current && activeTeamCodeRef.current === teamCode;
        if (!isMine && !isVisible) {
          setUnreadByTeam((prev) => ({ ...prev, [teamCode]: (prev[teamCode] ?? 0) + 1 }));
        }
      },
    });
    teamClientRef.current = client;
    return () => { client.disconnect(); teamClientRef.current = null; };
  }, [me, activeTeam]);

  // me가 바뀔 때마다 (로그인/닉네임 변경) 데몬에 토큰 동기화 — hook이 백엔드로 흘러가게.
  useEffect(() => {
    if (!me?.token) return;
    pushAgentSession({ token: me.token, userId: me.userId, displayName: me.displayName });
  }, [me?.token, me?.userId, me?.displayName]);

  // 활성 팀을 localStorage에 저장 — 위젯 창이 같은 팀을 보게
  useEffect(() => {
    if (activeTeam?.teamCode) {
      localStorage.setItem(envKey('mohani.activeTeamCode'), activeTeam.teamCode);
    }
  }, [activeTeam?.teamCode]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const r = await getAgentState();
      if (!cancelled) setAgentState(r);
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!me) {
    return (
      <Shell>
        <Login deviceId={deviceId} onLoggedIn={(s) => { session.save(s); setMe(s); }} setError={setError} error={error} />
      </Shell>
    );
  }

  if (teams.length === 0) {
    return (
      <Shell me={me}>
        <TeamSetup
          token={me.token}
          onTeamReady={(t) => { setTeams([t]); setActiveTeam(t); }}
          onError={handleApiError}
          error={error}
        />
      </Shell>
    );
  }

  return (
    <Shell
      me={me}
      team={activeTeam}
      teams={teams}
      onSelectTeam={(t) => {
        if (t.id === activeTeam?.id) return;
        setActiveTeam(t);
        setMembers([]); // 멤버는 새 API 호출이 필요 — 비웠다가 useEffect로 재로드
        // feedByTeam/activityByTeam은 보존 — 다른 팀에서 돌아왔을 때 그대로 남아있음
      }}
      onAddTeam={() => setDialog('team')}
      onLeaveTeam={() => setDialog('leave')}
      onRename={() => setDialog('rename')}
      onChangeAvatar={() => setDialog('avatar')}
      agent={agentState}
      onPrivacyToggle={async () => {
        const next = !agentState?.state?.isPrivate;
        await setAgentPrivacy(next);
        const r = await getAgentState();
        setAgentState(r);
      }}
      onLogout={() => {
        session.clear();
        setMe(null); setTeams([]); setActiveTeam(null);
        setActivityByTeam({}); setFeedByTeam({});
        setChatByTeam({}); setUnreadByTeam({}); setChatOpen(false);
      }}
      chat={{
        open: chatOpen,
        unread: unreadCount,
        onToggle: () => setChatOpen((v) => !v),
      }}
    >
      <main className="content" style={{ gridTemplateColumns: feedOpen ? `minmax(0, 1fr) ${feedWidth}px` : '1fr' }}>
        <FriendGrid
          members={members}
          activity={activity}
          loading={isLoadingTeam}
          myUserId={me.userId}
          onSelect={(member) => setSelectedMember(member)}
        />
        {feedOpen && (
          <FeedPanel
            feed={feed}
            width={feedWidth}
            onResize={setFeedWidth}
            onClose={() => setFeedOpen(false)}
          />
        )}
        {!feedOpen && (
          <button className="feed-reopen" onClick={() => setFeedOpen(true)} title="최근 활동 열기">
            ◀
          </button>
        )}
      </main>

      {selectedMember && activeTeam && (
        <MemberActivityDrawer
          token={me.token}
          team={activeTeam}
          member={selectedMember}
          stats={activity[selectedMember.userId]}
          onClose={() => setSelectedMember(null)}
          onError={handleApiError}
        />
      )}

      {chatOpen && activeTeam && (
        <ChatDrawer
          team={activeTeam}
          messages={chat}
          myUserId={me.userId}
          typingNames={typingNames}
          onClose={() => setChatOpen(false)}
          onSend={(payload) => teamClientRef.current?.sendChat(payload)}
          onTyping={() => teamClientRef.current?.sendTyping()}
        />
      )}

      {dialog === 'rename' && (
        <RenameDialog
          token={me.token}
          current={me.displayName}
          onClose={() => setDialog(null)}
          onSaved={(newName) => {
            const next = { ...me, displayName: newName };
            session.save(next);
            setMe(next);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'avatar' && (
        <AvatarDialog
          token={me.token}
          current={me.avatarUrl}
          onClose={() => setDialog(null)}
          onSaved={(newUrl) => {
            const next = { ...me, avatarUrl: newUrl };
            session.save(next);
            setMe(next);
            setDialog(null);
          }}
        />
      )}
      {dialog === 'leave' && activeTeam && (
        <LeaveDialog
          token={me.token}
          team={activeTeam}
          onClose={() => setDialog(null)}
          onLeft={() => {
            const leftCode = activeTeam.teamCode;
            const remaining = teams.filter((t) => t.id !== activeTeam.id);
            setTeams(remaining);
            setActiveTeam(remaining[0] ?? null);
            setMembers([]);
            // 떠난 팀의 캐시 정리
            setFeedByTeam((prev) => { const { [leftCode]: _, ...rest } = prev; return rest; });
            setActivityByTeam((prev) => { const { [leftCode]: _, ...rest } = prev; return rest; });
            setChatByTeam((prev) => { const { [leftCode]: _, ...rest } = prev; return rest; });
            setUnreadByTeam((prev) => { const { [leftCode]: _, ...rest } = prev; return rest; });
            setDialog(null);
          }}
        />
      )}
      {dialog === 'team' && (
        <TeamDialog
          token={me.token}
          onClose={() => setDialog(null)}
          onTeamReady={(t) => {
            setTeams((prev) => prev.some((x) => x.id === t.id) ? prev : [...prev, t]);
            setActiveTeam(t);
            setMembers([]);
            setDialog(null);
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children, me, team, teams, onSelectTeam, onAddTeam, onLeaveTeam, onRename, onChangeAvatar, agent, onPrivacyToggle, onLogout, chat }) {
  return (
    <div className="app">
      <Header
        me={me}
        team={team}
        teams={teams}
        onSelectTeam={onSelectTeam}
        onAddTeam={onAddTeam}
        onLeaveTeam={onLeaveTeam}
        onRename={onRename}
        onChangeAvatar={onChangeAvatar}
        agent={agent}
        onPrivacyToggle={onPrivacyToggle}
        onLogout={onLogout}
        chat={chat}
      />
      {children}
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return { open, setOpen, ref };
}

function Header({ me, team, teams, onSelectTeam, onAddTeam, onLeaveTeam, onRename, onChangeAvatar, agent, onPrivacyToggle, onLogout, chat }) {
  const userMenu = usePopover();
  const teamMenu = usePopover();
  const isPrivate = agent?.state?.isPrivate;
  const teamList = teams ?? [];

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-dot" />
        <span className="brand-name">모하니</span>
        {team && (
          <div className="team-pill-wrap" ref={teamMenu.ref}>
            <button className="team-pill" onClick={() => teamMenu.setOpen((v) => !v)}>
              <span className="team-name">{team.name}</span>
              <span className="team-code">{team.teamCode}</span>
              <span className="caret">▾</span>
            </button>
            {teamMenu.open && (
              <div className="menu team-menu">
                <div className="menu-section">내 팀</div>
                {teamList.map((t) => (
                  <button
                    key={t.id}
                    className={`menu-item team-item ${t.id === team.id ? 'selected' : ''}`}
                    onClick={() => { onSelectTeam?.(t); teamMenu.setOpen(false); }}
                  >
                    <span className="team-item-name">{t.name}</span>
                    <span className="team-item-code">{t.teamCode}</span>
                  </button>
                ))}
                <div className="menu-divider" />
                {onAddTeam && (
                  <button className="menu-item" onClick={() => { onAddTeam(); teamMenu.setOpen(false); }}>
                    + 팀 만들기 / 가입하기
                  </button>
                )}
                {onLeaveTeam && (
                  <button className="menu-item danger" onClick={() => { onLeaveTeam(); teamMenu.setOpen(false); }}>
                    현재 팀 나가기
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {isPrivate && <span className="status-chip private">비공개 모드</span>}
      </div>
      <div className="grow" />
      {me && team && chat && (
        <button
          className={`chat-toggle ${chat.open ? 'active' : ''}`}
          onClick={chat.onToggle}
          title="팀 채팅"
        >
          <span aria-hidden="true">💬</span>
          <span className="chat-toggle-label">채팅</span>
          {chat.unread > 0 && <span className="chat-unread">{chat.unread > 99 ? '99+' : chat.unread}</span>}
        </button>
      )}
      {me && (
        <div className="header-actions" ref={userMenu.ref}>
          <button className="me-button" onClick={() => userMenu.setOpen((v) => !v)}>
            <Avatar name={me.displayName} seed={me.userId} size={28} url={me.avatarUrl} />
            <span className="me-name">{me.displayName}</span>
            <span className="caret">▾</span>
          </button>
          {userMenu.open && (
            <div className="menu">
              {onRename && (
                <button className="menu-item" onClick={() => { onRename(); userMenu.setOpen(false); }}>
                  닉네임 변경
                </button>
              )}
              {onChangeAvatar && (
                <button className="menu-item" onClick={() => { onChangeAvatar(); userMenu.setOpen(false); }}>
                  프로필 사진
                </button>
              )}
              {onPrivacyToggle && (
                <button className="menu-item" onClick={() => { onPrivacyToggle(); userMenu.setOpen(false); }}>
                  {isPrivate ? '비공개 해제' : '비공개로 전환'}
                </button>
              )}
              {typeof window !== 'undefined' && window.mohaniIpc?.toggleWidget && (
                <button className="menu-item" onClick={() => { window.mohaniIpc.toggleWidget(); userMenu.setOpen(false); }}>
                  미니 위젯 보기/숨기기
                </button>
              )}
              <button className="menu-item" onClick={() => { window.location.reload(); }}>
                새로고침
              </button>
              {onLogout && (
                <button className="menu-item danger" onClick={() => { onLogout(); userMenu.setOpen(false); }}>
                  로그아웃
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function Modal({ children, onClose, title }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function RenameDialog({ token, current, onClose, onSaved }) {
  const [name, setName] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <Modal title="닉네임 변경" onClose={onClose}>
      <label>새 닉네임</label>
      <input
        autoFocus
        value={name}
        maxLength={64}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('rename-save')?.click(); }}
      />
      <div className="actions">
        <button className="btn secondary" onClick={onClose}>취소</button>
        <button
          id="rename-save"
          className="btn primary"
          disabled={busy || !name.trim() || name.trim() === current}
          onClick={async () => {
            setBusy(true); setErr(null);
            try {
              const r = await updateMyDisplayName(token, name.trim());
              onSaved(r.displayName);
            } catch (e) { setErr(e.message); } finally { setBusy(false); }
          }}
        >{busy ? '저장 중...' : '저장'}</button>
      </div>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

function AvatarDialog({ token, current, onClose, onSaved }) {
  // 미리보기 흐름: 파일 선택 → 로컬 미리보기 + ImgBB 업로드 → PATCH /me/avatar
  const [preview, setPreview] = useState(current ?? null); // local objectURL or remote url
  const [uploadedUrl, setUploadedUrl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);
  const localUrlRef = useRef(null);

  useEffect(() => () => {
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
  }, []);

  const onPick = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('이미지 파일만 가능해요.'); return; }
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    const local = URL.createObjectURL(file);
    localUrlRef.current = local;
    setPreview(local);
    setUploadedUrl(null);
    setBusy(true); setErr(null);
    try {
      const { url } = await uploadToImgBb(file);
      setUploadedUrl(url);
    } catch (e) {
      setErr(e instanceof ImgBbError ? e.message : '업로드 실패');
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!uploadedUrl) return;
    setBusy(true); setErr(null);
    try {
      const r = await updateMyAvatar(token, uploadedUrl);
      onSaved(r.avatarUrl);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setErr(null);
    try {
      await updateMyAvatar(token, null);
      onSaved(null);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="프로필 사진" onClose={onClose}>
      <div className="avatar-dialog">
        <div className="avatar-preview">
          {preview
            ? <img src={preview} alt="" />
            : <div className="avatar-empty">이미지 없음</div>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
        />
        <div className="actions" style={{ flexWrap: 'wrap' }}>
          <button className="btn secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
            {preview ? '다른 이미지 선택' : '이미지 선택'}
          </button>
          {current && (
            <button className="btn secondary" onClick={remove} disabled={busy}>
              제거
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn secondary" onClick={onClose}>닫기</button>
          <button className="btn primary" onClick={save} disabled={busy || !uploadedUrl}>
            {busy ? '처리 중...' : '저장'}
          </button>
        </div>
        {busy && !uploadedUrl && <div className="hint">ImgBB에 업로드 중…</div>}
        {err && <div className="error">{err}</div>}
      </div>
    </Modal>
  );
}

function LeaveDialog({ token, team, onClose, onLeft }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <Modal title="팀 나가기" onClose={onClose}>
      <p style={{ margin: '0 0 16px', color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--text)' }}>{team.name}</strong>{' '}
        (<code style={{ color: 'var(--warn)' }}>{team.teamCode}</code>)에서 나갈게요.<br />
        혼자 있는 팀이면 팀이 자동 삭제돼요.
      </p>
      <div className="actions">
        <button className="btn secondary" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await leaveTeam(token, team.id); onLeft(); }
          catch (e) { setErr(e.message); } finally { setBusy(false); }
        }}>{busy ? '나가는 중...' : '나가기'}</button>
      </div>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

function TeamDialog({ token, onClose, onTeamReady }) {
  const [tab, setTab] = useState('join');
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  return (
    <Modal title="팀 추가" onClose={onClose}>
      <div className="tabs">
        <button className={`tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>코드로 가입</button>
        <button className={`tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>새 팀 만들기</button>
      </div>
      {tab === 'join' ? (
        <>
          <label>팀 코드</label>
          <input
            className="code-input"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
          />
          <div className="actions">
            <button className="btn secondary" onClick={onClose}>취소</button>
            <button className="btn primary" disabled={busy || code.length !== 6} onClick={async () => {
              setBusy(true); setErr(null);
              try { onTeamReady(await joinTeam(token, code)); }
              catch (e) { setErr(e.message); } finally { setBusy(false); }
            }}>{busy ? '...' : '가입'}</button>
          </div>
        </>
      ) : (
        <>
          <label>팀 이름</label>
          <input
            autoFocus
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="우리 사이드프로젝트"
          />
          <div className="actions">
            <button className="btn secondary" onClick={onClose}>취소</button>
            <button className="btn primary" disabled={busy || !teamName.trim()} onClick={async () => {
              setBusy(true); setErr(null);
              try { onTeamReady(await createTeam(token, teamName.trim())); }
              catch (e) { setErr(e.message); } finally { setBusy(false); }
            }}>{busy ? '...' : '만들기'}</button>
          </div>
        </>
      )}
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

function Login({ deviceId, onLoggedIn, setError, error }) {
  const [backend, setBackend] = useState(getBackendUrl());
  const [busy, setBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // deviceId 기반 자동 이름 — 가입 후 메뉴에서 언제든 바꿀 수 있음
  const autoName = useMemo(() => `친구-${deviceId.slice(0, 4)}`, [deviceId]);

  return (
    <div className="center">
      <div className="hero">
        <div className="hero-emoji">👋</div>
        <h1 className="hero-title">친구가 지금 뭐하나, 모하니</h1>
        <p className="hero-sub">버튼 한 번이면 시작이에요. 닉네임은 나중에 메뉴에서 바꿀 수 있어요.</p>
      </div>
      <div className="card">
        <div className="actions">
          <button className="btn primary block" disabled={busy} autoFocus onClick={async () => {
            setBusy(true); setError(null);
            try {
              setBackendUrl(backend);
              const r = await loginAnonymous(deviceId, autoName);
              onLoggedIn(r);
            } catch (e) { setError(e.message); } finally { setBusy(false); }
          }}>{busy ? '잠시만...' : '시작하기'}</button>
        </div>
        {error && <div className="error">{error}</div>}
        <button className="link" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? '고급 설정 닫기' : '고급 설정'}
        </button>
        {showAdvanced && (
          <>
            <label>백엔드 주소</label>
            <input value={backend} onChange={(e) => setBackend(e.target.value)} />
            <p className="hint">기기 식별자: {deviceId.slice(0, 8)}…</p>
            <p className="hint">자동 닉네임: {autoName} (가입 후 메뉴에서 변경)</p>
          </>
        )}
      </div>
    </div>
  );
}

function TeamSetup({ token, onTeamReady, onError, error }) {
  const [tab, setTab] = useState('create');
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="center">
      <div className="hero">
        <h1 className="hero-title">팀을 만들거나, 친구의 코드를 입력하세요</h1>
        <p className="hero-sub">팀 코드 6자리만 있으면 친구 작업이 보여요.</p>
      </div>
      <div className="card">
        <div className="tabs">
          <button className={`tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>새 팀 만들기</button>
          <button className={`tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>코드로 가입</button>
        </div>
        {tab === 'create' ? (
          <>
            <label>팀 이름</label>
            <input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="우리 사이드프로젝트"
            />
            <div className="actions">
              <button className="btn primary block" disabled={!teamName || busy} onClick={async () => {
                setBusy(true);
                try { onTeamReady(await createTeam(token, teamName)); }
                catch (e) { onError(e); } finally { setBusy(false); }
              }}>만들기</button>
            </div>
          </>
        ) : (
          <>
            <label>팀 코드</label>
            <input
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              maxLength={6}
            />
            <div className="actions">
              <button className="btn primary block" disabled={code.length !== 6 || busy} onClick={async () => {
                setBusy(true);
                try { onTeamReady(await joinTeam(token, code)); }
                catch (e) { onError(e); } finally { setBusy(false); }
              }}>가입</button>
            </div>
          </>
        )}
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}

function FriendGrid({ members, activity, loading, myUserId, onSelect }) {
  if (members.length === 0) {
    return (
      <section className="grid-empty">
        <p>아직 팀원이 없어요. 팀 코드를 친구한테 공유해보세요.</p>
      </section>
    );
  }
  return (
    <section className="grid">
      {members.map((m) => {
        const a = activity[m.userId];
        const active = a && Date.now() - a.lastSeen < ACTIVE_WINDOW_MS;
        const tokens = a?.todayTokens ?? 0;
        const minutes = Math.round((a?.todayDurationSec ?? 0) / 60);
        const isMe = m.userId === myUserId;
        const showSkeleton = loading && !a;
        // 카드의 핵심 한 줄: 진행 중 작업 > 마지막 작업 > 빈 상태 메시지
        const promptLine = a?.promptFirstLine
          ? a.promptFirstLine
          : active
            ? '작업 중…'
            : a?.lastSeen
              ? '오늘 잠시 작업했어요. 클릭해서 활동 보기'
              : '오늘은 아직 조용해요';
        return (
          <article
            key={m.userId}
            className={`member-card ${active ? 'active' : 'idle'} clickable ${showSkeleton ? 'skeleton' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect?.(m)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(m); }}
            title="클릭해서 최근 활동 보기"
          >
            <header className="member-head">
              <Avatar name={m.displayName} seed={m.userId} size={44} ring={active} url={m.avatarUrl} />
              <div className="member-meta">
                <div className="member-name">
                  {m.displayName}
                  {isMe && <span className="me-tag">나</span>}
                  <CliBadge kind={a?.cliKind} />
                </div>
                <div className="member-status">
                  <span className={`dot ${active ? 'on' : 'off'}`} />
                  {active ? '작업 중' : '쉬는 중'}
                </div>
              </div>
              <span className="card-chevron" aria-hidden="true">›</span>
            </header>
            <p className={`prompt ${a?.promptFirstLine ? '' : 'prompt-muted'}`}>
              {showSkeleton ? <span className="skel-line" /> : promptLine}
            </p>
            <footer className="member-foot">
              <div className="stat">
                {showSkeleton
                  ? <span className="skel-num" />
                  : <span className="stat-num">{tokens.toLocaleString()}</span>}
                <span className="stat-label">토큰</span>
              </div>
              <div className="stat">
                {showSkeleton
                  ? <span className="skel-num" />
                  : <span className="stat-num">{minutes}</span>}
                <span className="stat-label">분</span>
              </div>
              {a?.toolName && (
                <div className="stat">
                  <span className="stat-num">{a.toolName}</span>
                  <span className="stat-label">도구</span>
                </div>
              )}
            </footer>
          </article>
        );
      })}
    </section>
  );
}

function MemberActivityDrawer({ token, team, member, stats, onClose, onError }) {
  const [items, setItems] = useState(null); // null = 로딩
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    let alive = true;
    setItems(null);
    setExpandedId(null);
    getRecentActivity(token, team.id, member.userId, 10)
      .then((rows) => { if (alive) setItems(rows); })
      .catch((e) => {
        if (!alive) return;
        if (!onError?.(e)) setItems([]);
      });
    return () => { alive = false; };
  }, [token, team.id, member.userId]);

  const tokens = stats?.todayTokens ?? 0;
  const minutes = Math.round((stats?.todayDurationSec ?? 0) / 60);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${member.displayName}의 활동`}>
        <header className="drawer-head">
          <Avatar name={member.displayName} seed={member.userId} size={36} url={member.avatarUrl} />
          <div className="drawer-meta">
            <div className="drawer-name">{member.displayName}</div>
            <div className="drawer-stats">
              <span><b>{tokens.toLocaleString()}</b> 토큰</span>
              <span><b>{minutes}</b> 분</span>
            </div>
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="닫기">×</button>
        </header>
        <div className="drawer-body">
          <h4 className="drawer-section">최근 활동</h4>
          {items === null && <div className="drawer-empty">불러오는 중…</div>}
          {items && items.length === 0 && (
            <div className="drawer-empty">아직 기록이 없어요.</div>
          )}
          {items && items.length > 0 && (
            <ul className="drawer-list">
              {items
                .filter((it) => (it.promptFirstLine && it.promptFirstLine.length > 0)
                              || (it.assistantPreview && it.assistantPreview.length > 0))
                .map((it) => {
                const open = expandedId === it.id;
                return (
                  <li
                    key={it.id}
                    className={`drawer-item turn ${open ? 'open' : ''}`}
                    onClick={() => setExpandedId(open ? null : it.id)}
                  >
                    <div className="drawer-item-head">
                      <span className="drawer-item-time">{formatTime(it.occurredAt)}</span>
                      <CliBadge kind={it.cliKind} />
                      {it.promptFirstLine && <span className="kind-badge q">질문</span>}
                      {it.assistantPreview && <span className="kind-badge a">답변</span>}
                      <span className="drawer-caret">{open ? '▾' : '▸'}</span>
                    </div>
                    {it.promptFirstLine && (
                      <div className="turn-q">
                        <span className="turn-text">{it.promptFirstLine}</span>
                      </div>
                    )}
                    {it.assistantPreview && (
                      <div className="turn-a">
                        <span className="turn-text">{it.assistantPreview}</span>
                      </div>
                    )}
                    {open && (
                      <div className="drawer-item-detail">
                        {it.promptFull && it.promptFull !== it.promptFirstLine && (
                          <div className="turn-full">
                            <div className="turn-full-label">전체 질문</div>
                            <pre className="turn-full-text">{it.promptFull}</pre>
                          </div>
                        )}
                        {it.assistantFull && it.assistantFull !== it.assistantPreview && (
                          <div className="turn-full">
                            <div className="turn-full-label">전체 답변</div>
                            <pre className="turn-full-text">{it.assistantFull}</pre>
                          </div>
                        )}
                        <div className="turn-meta">
                          {it.toolUseCount > 0 && <span>도구 {it.toolUseCount}회</span>}
                          {it.responseTokens > 0 && <span>응답 {it.responseTokens.toLocaleString()} 토큰</span>}
                          <span>{new Date(it.occurredAt).toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.round((now - d.getTime()) / 1000);
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.round(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.round(diff / 3600)}시간 전`;
  return d.toLocaleDateString();
}

function ChatDrawer({ team, messages, myUserId, typingNames = [], onClose, onSend, onTyping }) {
  // ESC: 라이트박스 우선 닫기 → 그 다음 드로어
  // (라이트박스 상태는 ChatPanelBody가 들고 있음 — keydown은 거기서 처리)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.chat-lightbox')) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer chat-drawer" role="dialog" aria-label={`${team.name} 팀 채팅`}>
        <header className="drawer-head">
          <div className="drawer-meta">
            <div className="drawer-name">{team.name} · 팀 채팅</div>
            <div className="drawer-stats chat-hint">
              새로고침/팀 변경 시 사라져요 · ESC로 닫기
              {window.mohaniIpc?.toggleChat && (
                <button
                  className="chat-popout-btn"
                  onClick={() => { window.mohaniIpc.toggleChat(); onClose(); }}
                  title="별도 창으로 띄우기"
                >⤢ 팝업</button>
              )}
            </div>
          </div>
        </header>
        <ChatPanelBody
          messages={messages}
          myUserId={myUserId}
          typingNames={typingNames}
          onSend={onSend}
          onTyping={onTyping}
        />
      </aside>
    </>
  );
}

function ChatPanelBody({ messages, myUserId, typingNames = [], onSend, onTyping }) {
  const [draft, setDraft] = useState('');
  // 첨부 이미지 상태: { file, previewUrl, status: 'pending'|'uploading'|'uploaded'|'failed', uploadedUrl, progress, error }
  const [attachment, setAttachment] = useState(null);
  const [lightbox, setLightbox] = useState(null); // 클릭한 이미지 url
  const [dragOver, setDragOver] = useState(false);
  // 스크롤 추적: 사용자가 위로 스크롤한 상태에서는 강제로 끌어내리지 않는다.
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const uploadTokenRef = useRef(null);
  const isAtBottomRef = useRef(true);
  const prevLenRef = useRef(messages.length);

  const scrollToBottom = (smooth = true) => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  const onScrollList = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 80;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
    if (atBottom) setUnseenCount(0);
  };

  // 마운트 직후 — 기존 버퍼 메시지를 보고 즉시 맨 아래로 점프 (애니메이션 없이)
  useEffect(() => {
    scrollToBottom(false);
    prevLenRef.current = messages.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 메시지 추가 시: 본인이 보낸 거거나 이미 맨 아래면 자동 스크롤. 위로 올려서 읽는 중이면 그대로 두고 unseen 카운트 ↑
  useEffect(() => {
    const prev = prevLenRef.current;
    prevLenRef.current = messages.length;
    if (messages.length <= prev) return; // 새 메시지 없음
    const last = messages[messages.length - 1];
    const isMine = last && last.userId === myUserId;
    if (isAtBottomRef.current || isMine) {
      scrollToBottom(true);
      setUnseenCount(0);
    } else {
      setUnseenCount((n) => n + (messages.length - prev));
    }
  }, [messages.length, myUserId]);

  // 열리면 입력창에 포커스
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC: 라이트박스가 열려있으면 닫고, 그 외엔 부모(ChatDrawer/ChatStandalone)가 처리
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setLightbox(null); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [lightbox]);

  // 미리보기 URL revoke (메모리 누수 방지)
  useEffect(() => {
    return () => {
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    };
  }, [attachment?.previewUrl]);

  // 업로드 완료되면 입력창에 포커스 — Enter로 즉시 송신할 수 있게
  useEffect(() => {
    if (attachment?.status === 'uploaded') inputRef.current?.focus();
  }, [attachment?.status]);

  // 첨부 시점에 즉시 업로드 시작 — 사용자는 그동안 캡션 작성 가능.
  // 송신 전에 끝나면 바로 보내기, 아직 업로드 중이면 송신 버튼이 disable.
  const acceptFile = async (file) => {
    if (!file || !file.type?.startsWith('image/')) return;
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    const previewUrl = URL.createObjectURL(file);
    // 업로드 토큰 — 새 첨부가 들어왔을 때 이전 업로드 응답을 무시하기 위함
    const myToken = Symbol('upload');
    uploadTokenRef.current = myToken;
    setAttachment({ file, previewUrl, status: 'uploading', progress: 0 });
    try {
      const { url } = await uploadToImgBb(file, {
        onProgress: (p) => {
          if (uploadTokenRef.current !== myToken) return;
          setAttachment((a) => a && a.file === file ? { ...a, progress: p } : a);
        },
      });
      if (uploadTokenRef.current !== myToken) return; // 사용자가 다른 파일로 교체
      setAttachment((a) => a && a.file === file
        ? { ...a, status: 'uploaded', uploadedUrl: url, progress: 1 }
        : a);
    } catch (err) {
      if (uploadTokenRef.current !== myToken) return;
      const msg = err instanceof ImgBbError ? err.message : '업로드 실패';
      setAttachment((a) => a && a.file === file ? { ...a, status: 'failed', error: msg } : a);
    }
  };

  const onPaste = (e) => {
    const item = Array.from(e.clipboardData?.items ?? []).find((it) => it.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) {
      e.preventDefault();
      acceptFile(file);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) acceptFile(file);
  };

  const removeAttachment = () => {
    if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    setAttachment(null);
  };

  const submit = () => {
    const t = draft.trim();
    if (!t && !attachment) return;
    // 첨부가 있는데 아직 업로드 안 끝났으면 송신 거절 (버튼도 disabled)
    if (attachment && attachment.status !== 'uploaded') return;
    const imageUrl = attachment?.uploadedUrl ?? null;
    const ok = onSend?.({ text: t || null, imageUrl });
    if (ok !== false) {
      setDraft('');
      removeAttachment();
    }
  };

  const retryUpload = () => {
    if (!attachment?.file) return;
    acceptFile(attachment.file);
  };

  const onKeyDown = (e) => {
    // Enter = 송신, Shift+Enter는 일반 input이라 줄바꿈 없음 — 그냥 Enter만
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div
      className={`chat-panel-body ${dragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
        <div className="chat-list" ref={listRef} onScroll={onScrollList}>
          {messages.length === 0 && (
            <div className="drawer-empty">첫 메시지를 남겨보세요. 이미지는 붙여넣기/드래그/📎 버튼.</div>
          )}
          {messages.map((m, idx) => {
            const isMine = m.userId === myUserId;
            const prev = messages[idx - 1];
            const sameSender = prev && prev.userId === m.userId
              && Math.abs(Date.parse(m.sentAt) - Date.parse(prev.sentAt)) < 60_000;
            return (
              <div key={m._key ?? `${m.userId}-${m.sentAt}-${idx}`} className={`chat-row ${isMine ? 'mine' : ''}`}>
                {!isMine && !sameSender && (
                  <div className="chat-avatar">
                    <Avatar name={m.displayName} seed={m.userId} size={28} url={m.avatarUrl} />
                  </div>
                )}
                {!isMine && sameSender && <div className="chat-avatar-spacer" />}
                <div className="chat-bubble-wrap">
                  {!sameSender && (
                    <div className="chat-meta">
                      <span className="chat-sender">{isMine ? '나' : m.displayName}</span>
                      <span className="chat-time">{formatTime(m.sentAt)}</span>
                    </div>
                  )}
                  {m.imageUrl && (
                    <button
                      type="button"
                      className="chat-image-btn"
                      onClick={() => setLightbox(m.imageUrl)}
                      aria-label="이미지 크게 보기"
                    >
                      <img src={m.imageUrl} alt="" loading="lazy" />
                    </button>
                  )}
                  {m.text && <div className="chat-bubble">{m.text}</div>}
                </div>
              </div>
            );
          })}
        </div>

        {!isAtBottom && (
          <button
            type="button"
            className={`chat-scroll-bottom ${unseenCount > 0 ? 'has-unseen' : ''}`}
            onClick={() => { scrollToBottom(true); setUnseenCount(0); }}
            aria-label="맨 아래로"
          >
            {unseenCount > 0 ? `↓ 새 메시지 ${unseenCount}` : '↓'}
          </button>
        )}

        {typingNames.length > 0 && (
          <div className="chat-typing">
            <span className="chat-typing-dots"><span /><span /><span /></span>
            <span>
              {typingNames.length === 1
                ? `${typingNames[0]} 입력 중`
                : `${typingNames[0]} 외 ${typingNames.length - 1}명 입력 중`}
            </span>
          </div>
        )}

        {attachment && (
          <div className={`chat-attachment status-${attachment.status}`}>
            <img src={attachment.previewUrl} alt="첨부 이미지" />
            <div className="chat-attachment-meta">
              {attachment.status === 'uploading' && (
                <span>업로드 중… {Math.round((attachment.progress ?? 0) * 100)}%</span>
              )}
              {attachment.status === 'failed' && (
                <>
                  <span className="error">{attachment.error}</span>
                  <button type="button" className="chat-attachment-retry" onClick={retryUpload}>
                    다시 시도
                  </button>
                </>
              )}
              {attachment.status === 'uploaded' && <span>업로드 완료 · 보내기로 전송</span>}
            </div>
            <button
              type="button"
              className="chat-attachment-remove"
              onClick={removeAttachment}
              aria-label="첨부 제거"
            >×</button>
          </div>
        )}

        <form
          className="chat-input"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <button
            type="button"
            className="chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            title="이미지 첨부"
            aria-label="이미지 첨부"
          >📎</button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { acceptFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) onTyping?.();
            }}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            placeholder="메시지 입력 · 붙여넣기로 이미지 첨부"
            maxLength={1000}
          />
          <button
            type="submit"
            disabled={(!draft.trim() && !attachment) || attachment?.status === 'uploading'}
          >보내기</button>
        </form>

      {lightbox && (
        <div className="chat-lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="이미지 보기">
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function FeedPanel({ feed, width, onResize, onClose }) {
  // 좌측 핸들 드래그로 폭 조절. 220 ~ 560px 범위.
  const dragRef = useRef(null);
  const [expandedKey, setExpandedKey] = useState(null);
  useEffect(() => {
    const handle = dragRef.current;
    if (!handle) return;
    let startX = 0;
    let startW = width;
    const onMove = (e) => {
      const dx = startX - e.clientX; // 왼쪽으로 드래그하면 폭 증가
      const next = Math.max(220, Math.min(560, startW + dx));
      onResize(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    const onDown = (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };
    handle.addEventListener('mousedown', onDown);
    return () => handle.removeEventListener('mousedown', onDown);
  }, [width, onResize]);

  return (
    <aside className="feed">
      <div className="feed-resize-handle" ref={dragRef} title="드래그로 폭 조절" />
      <div className="feed-head-row">
        <h3 className="feed-title">최근에 뭐 했나</h3>
        <button className="feed-close" onClick={onClose} title="닫기" aria-label="피드 닫기">×</button>
      </div>
      <div className="feed-scroll">
        {feed.length === 0 && (
          <div className="feed-empty">최근 작업이 여기 쌓여요.<br />Claude Code에서 프롬프트를 입력해보세요.</div>
        )}
        <ul className="feed-list">
          {feed.map((f, i) => {
            const key = `${f._ts}-${i}`;
            const open = expandedKey === key;
            return (
              <li
                key={key}
                className={`feed-item ${open ? 'open' : ''}`}
                onClick={() => setExpandedKey(open ? null : key)}
              >
                <Avatar name={f.displayName} seed={f.userId} size={26} url={f.avatarUrl} />
                <div className="feed-body">
                  <div className="feed-head">
                    <span className="feed-who">{f.displayName}</span>
                    <CliBadge kind={f.cliKind} />
                    <span className="feed-time">{relativeTime(f._ts)}</span>
                  </div>
                  {f.promptFirstLine && (
                    <div className={`feed-prompt ${open ? 'wrap' : ''}`}>
                      <span className="turn-label q">Q</span> {f.promptFirstLine}
                    </div>
                  )}
                  {f.assistantPreview && (
                    <div className={`feed-answer ${open ? 'wrap' : ''}`}>
                      <span className="turn-label a">A</span> {f.assistantPreview}
                    </div>
                  )}
                  {open && (
                    <div className="feed-detail">
                      {f.toolUseCount > 0 && <span><b>도구</b> {f.toolUseCount}회</span>}
                      {f.responseTokens > 0 && <span><b>응답</b> {f.responseTokens.toLocaleString()}t</span>}
                      <span><b>토큰(today)</b> {(f.todayTokens ?? 0).toLocaleString()}</span>
                      <span><b>분</b> {Math.round((f.todayDurationSec ?? 0) / 60)}</span>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

function relativeTime(ts) {
  if (!ts) return '';
  const sec = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.round(hr / 24)}일 전`;
}

// ─── Mini Widget ────────────────────────────────────────────────
// 항상 위에 떠있는 작은 창. 메인 창과 데이터(localStorage·STOMP) 공유.
// 채팅 전용 팝업 창 — 메인 앱과 별도 STOMP 연결, 동일 토픽 구독.
// 새로고침 시 메시지는 사라짐(휘발 정책 동일). 활성팀은 localStorage에서 읽음.
function ChatStandalone() {
  const [me] = useState(session.load());
  const [team, setTeam] = useState(null);
  const [messages, setMessages] = useState([]);
  const [typingMap, setTypingMap] = useState({});
  const clientRef = useRef(null);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    listMyTeams(me.token).then((ts) => {
      if (cancelled) return;
      const saved = localStorage.getItem(envKey('mohani.activeTeamCode'));
      const t = ts.find((x) => x.teamCode === saved) ?? ts[0] ?? null;
      setTeam(t);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [me]);

  useEffect(() => {
    if (!me || !team) return;
    const client = createTeamClient({
      token: me.token,
      teamCode: team.teamCode,
      onChat: (msg) => {
        const item = { ...msg, _key: `${msg.userId}-${msg.sentAt}-${Math.random().toString(36).slice(2, 6)}` };
        setMessages((prev) => {
          const next = [...prev, item];
          if (next.length > 200) next.splice(0, next.length - 200);
          return next;
        });
        // 메시지 도착 → 해당 사용자 typing 정리
        setTypingMap((prev) => {
          if (!prev[msg.userId]) return prev;
          const { [msg.userId]: _, ...rest } = prev;
          return rest;
        });
      },
      onTyping: (evt) => {
        if (!evt || evt.userId === me.userId) return;
        setTypingMap((prev) => ({
          ...prev,
          [evt.userId]: { userId: evt.userId, displayName: evt.displayName, expiresAt: Date.now() + 5000 },
        }));
      },
    });
    clientRef.current = client;
    return () => { client.disconnect(); clientRef.current = null; };
  }, [me, team]);

  // typing 만료 정리
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setTypingMap((prev) => {
        let changed = false;
        const next = {};
        for (const [uid, t] of Object.entries(prev)) {
          if (t.expiresAt > now) next[uid] = t;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const typingNames = Object.values(typingMap)
    .filter((t) => t.expiresAt > Date.now())
    .map((t) => t.displayName);

  if (!me) {
    return <div className="chat-standalone empty">먼저 메인 창에서 로그인하세요.</div>;
  }
  if (!team) {
    return <div className="chat-standalone empty">팀이 없어요. 메인 창에서 가입하세요.</div>;
  }

  return (
    <div className="chat-standalone">
      <div className="chat-standalone-head">
        <span>{team.name} · 팀 채팅</span>
        <span className="chat-standalone-hint">새로고침 시 사라져요</span>
      </div>
      <ChatPanelBody
        messages={messages}
        myUserId={me.userId}
        typingNames={typingNames}
        onSend={(payload) => clientRef.current?.sendChat(payload)}
        onTyping={() => clientRef.current?.sendTyping()}
      />
    </div>
  );
}

function WidgetApp() {
  const [me] = useState(session.load());
  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [activity, setActivity] = useState({});

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    listMyTeams(me.token).then((ts) => {
      if (cancelled) return;
      const saved = localStorage.getItem(envKey('mohani.activeTeamCode'));
      const t = ts.find((x) => x.teamCode === saved) ?? ts[0] ?? null;
      setTeam(t);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [me]);

  useEffect(() => {
    if (!me || !team) return;
    listTeamMembers(me.token, team.id).then(setMembers).catch(() => {});
    const client = createTeamClient({
      token: me.token,
      teamCode: team.teamCode,
      onMessage: (msg) => {
        setActivity((prev) => ({
          ...prev,
          [msg.userId]: {
            promptFirstLine: msg.promptFirstLine ?? prev[msg.userId]?.promptFirstLine ?? null,
            todayTokens: msg.todayTokens,
            todayDurationSec: msg.todayDurationSec,
            lastSeen: Date.now(),
            displayName: msg.displayName,
          },
        }));
      },
    });
    return () => client.disconnect();
  }, [me, team]);

  return (
    <div className="widget">
      <div className="widget-drag" />
      <div className="widget-head">
        <span className="widget-brand">
          <span className="widget-dot" />
          {team?.name ?? '모하니'}
        </span>
        <button
          className="widget-btn"
          title="메인 창 열기"
          onClick={() => window.mohaniIpc?.openMainWindow?.()}
        >⤢</button>
        <button
          className="widget-btn"
          title="위젯 닫기"
          onClick={() => window.mohaniIpc?.toggleWidget?.()}
        >×</button>
      </div>
      <div className="widget-body">
        {!me && <div className="widget-empty">먼저 메인 창에서 가입하세요</div>}
        {me && !team && <div className="widget-empty">팀이 없어요. 메인 창에서 만들거나 가입.</div>}
        {me && team && members.length === 0 && (
          <div className="widget-empty">팀원 로딩 중...</div>
        )}
        {me && team && members.map((m) => {
          const a = activity[m.userId];
          const active = a && Date.now() - a.lastSeen < 90_000;
          return (
            <div key={m.userId} className={`widget-row ${active ? 'on' : ''}`}>
              <Avatar name={m.displayName} seed={m.userId} size={22} ring={active} url={m.avatarUrl} />
              <div className="widget-text">
                <div className="widget-name">{m.displayName}</div>
                <div className="widget-prompt">
                  {a?.promptFirstLine || (active ? '...' : '쉬는 중')}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
