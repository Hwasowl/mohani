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
  updateMyDisplayName,
} from './api.js';
import { createTeamClient } from './stomp.js';

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

function Avatar({ name, seed, size = 40, ring }) {
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  const hue = hashHue(seed ?? name);
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
  // URL hash로 메인/위젯 모드 분기
  if (typeof window !== 'undefined' && window.location.hash === '#widget') {
    return <WidgetApp />;
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
  const [agentState, setAgentState] = useState(null);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'rename' | 'team' | 'leave' | null
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
    (async () => {
      try {
        const [ms, todayStats, feedItems] = await Promise.all([
          listTeamMembers(me.token, activeTeam.id),
          getTeamTodayStats(me.token, activeTeam.id),
          getTeamFeed(me.token, activeTeam.id, 30),
        ]);
        setMembers(ms);
        // 첫 진입에 토큰/시간/lastSeen이 즉시 보이도록 activityByTeam 채움.
        // WSS 메시지가 도착하면 그 위에 덮어써서 실시간 갱신 유지.
        setActivityByTeam((prev) => {
          const existing = prev[teamCode] ?? {};
          const next = { ...existing };
          for (const s of todayStats) {
            const lastSeenMs = s.lastSeen ? Date.parse(s.lastSeen) : null;
            next[s.userId] = {
              ...next[s.userId],
              todayTokens: s.todayTokens ?? 0,
              todayDurationSec: s.todayDurationSec ?? 0,
              lastSeen: lastSeenMs ?? next[s.userId]?.lastSeen ?? null,
            };
          }
          return { ...prev, [teamCode]: next };
        });
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
              userId: it.userId,
              displayName: it.displayName,
              promptFirstLine: it.promptFirstLine,
              cliKind: it.cliKind,
              _ts: Date.parse(it.occurredAt),
            }));
          // 합치고 시간순(최신 먼저) 정렬, 30개로 cap
          const merged = [...existing, ...hydrated]
            .sort((a, b) => (b._ts ?? 0) - (a._ts ?? 0))
            .slice(0, 30);
          return { ...prev, [teamCode]: merged };
        });
      } catch (e) { handleApiError(e); }
    })();
  }, [me, activeTeam]);

  useEffect(() => {
    if (!me || !activeTeam) return;
    const teamCode = activeTeam.teamCode;
    const dispose = createTeamClient({
      token: me.token,
      teamCode,
      onMessage: (msg) => {
        // 피드는 의미있는 이벤트(질문)만 — PreToolUse/PostToolUse는 노이즈
        if (msg.event === 'UserPromptSubmit' && msg.promptFirstLine) {
          setFeedByTeam((prev) => {
            const cur = prev[teamCode] ?? [];
            return { ...prev, [teamCode]: [{ ...msg, _ts: Date.now() }, ...cur].slice(0, 30) };
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
    });
    return dispose;
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
      }}
    >
      <main className="content" style={{ gridTemplateColumns: feedOpen ? `minmax(0, 1fr) ${feedWidth}px` : '1fr' }}>
        <FriendGrid
          members={members}
          activity={activity}
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

function Shell({ children, me, team, teams, onSelectTeam, onAddTeam, onLeaveTeam, onRename, agent, onPrivacyToggle, onLogout }) {
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
        agent={agent}
        onPrivacyToggle={onPrivacyToggle}
        onLogout={onLogout}
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

function Header({ me, team, teams, onSelectTeam, onAddTeam, onLeaveTeam, onRename, agent, onPrivacyToggle, onLogout }) {
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
      {me && (
        <div className="header-actions" ref={userMenu.ref}>
          <button className="me-button" onClick={() => userMenu.setOpen((v) => !v)}>
            <Avatar name={me.displayName} seed={me.userId} size={28} />
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

function FriendGrid({ members, activity, myUserId, onSelect }) {
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
        return (
          <article
            key={m.userId}
            className={`member-card ${active ? 'active' : 'idle'} clickable`}
            role="button"
            tabIndex={0}
            onClick={() => onSelect?.(m)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect?.(m); }}
          >
            <header className="member-head">
              <Avatar name={m.displayName} seed={m.userId} size={44} ring={active} />
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
            </header>
            <p className="prompt">
              {a?.promptFirstLine || (active ? '...' : '오늘은 아직 조용해요')}
            </p>
            <footer className="member-foot">
              <div className="stat">
                <span className="stat-num">{tokens.toLocaleString()}</span>
                <span className="stat-label">토큰</span>
              </div>
              <div className="stat">
                <span className="stat-num">{minutes}</span>
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
          <Avatar name={member.displayName} seed={member.userId} size={36} />
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
              {items.map((it) => {
                const open = expandedId === it.id;
                return (
                  <li
                    key={it.id}
                    className={`drawer-item ${open ? 'open' : ''}`}
                    onClick={() => setExpandedId(open ? null : it.id)}
                  >
                    <div className="drawer-item-head">
                      <span className="drawer-item-time">{formatTime(it.occurredAt)}</span>
                      <CliBadge kind={it.cliKind} />
                      <span className="drawer-caret">{open ? '▾' : '▸'}</span>
                    </div>
                    <div className="drawer-item-prompt">{it.promptFirstLine || '(빈 프롬프트)'}</div>
                    {open && (
                      <div className="drawer-item-detail">
                        <div><span>이벤트</span> {it.eventKind}</div>
                        <div><span>시각</span> {new Date(it.occurredAt).toLocaleString()}</div>
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
                <Avatar name={f.displayName} seed={f.userId} size={26} />
                <div className="feed-body">
                  <div className="feed-head">
                    <span className="feed-who">{f.displayName}</span>
                    <CliBadge kind={f.cliKind} />
                    <span className="feed-time">{relativeTime(f._ts)}</span>
                  </div>
                  <div className={`feed-prompt ${open ? 'wrap' : ''}`}>{f.promptFirstLine}</div>
                  {open && (
                    <div className="feed-detail">
                      {f.toolName && <span><b>도구</b> {f.toolName}</span>}
                      <span><b>토큰</b> {(f.todayTokens ?? 0).toLocaleString()}</span>
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
    const dispose = createTeamClient({
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
    return dispose;
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
              <Avatar name={m.displayName} seed={m.userId} size={22} ring={active} />
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
