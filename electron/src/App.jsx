import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeam,
  generateDeviceId,
  getAgentState,
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
    let id = localStorage.getItem('mohani.deviceId');
    if (!id) {
      id = generateDeviceId();
      localStorage.setItem('mohani.deviceId', id);
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
    (async () => {
      try {
        const ms = await listTeamMembers(me.token, activeTeam.id);
        setMembers(ms);
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
      <main className="content">
        <FriendGrid members={members} activity={activity} myUserId={me.userId} />
        <FeedPanel feed={feed} />
      </main>

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

function FriendGrid({ members, activity, myUserId }) {
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
          <article key={m.userId} className={`member-card ${active ? 'active' : 'idle'}`}>
            <header className="member-head">
              <Avatar name={m.displayName} seed={m.userId} size={44} ring={active} />
              <div className="member-meta">
                <div className="member-name">
                  {m.displayName}
                  {isMe && <span className="me-tag">나</span>}
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

function FeedPanel({ feed }) {
  return (
    <aside className="feed">
      <h3 className="feed-title">최근에 뭐 했나</h3>
      <div className="feed-scroll">
        {feed.length === 0 && (
          <div className="feed-empty">최근 작업이 여기 쌓여요.<br />Claude Code에서 프롬프트를 입력해보세요.</div>
        )}
        <ul className="feed-list">
          {feed.map((f, i) => (
            <li key={`${f._ts}-${i}`} className="feed-item">
              <Avatar name={f.displayName} seed={f.userId} size={26} />
              <div className="feed-body">
                <div className="feed-head">
                  <span className="feed-who">{f.displayName}</span>
                  <span className="feed-time">{relativeTime(f._ts)}</span>
                </div>
                <div className="feed-prompt">{f.promptFirstLine}</div>
              </div>
            </li>
          ))}
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
