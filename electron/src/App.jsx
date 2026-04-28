import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeam,
  generateDeviceId,
  getAgentState,
  joinTeam,
  listMyTeams,
  listTeamMembers,
  loginAnonymous,
  session,
  setAgentPrivacy,
  setBackendUrl,
  getBackendUrl,
} from './api.js';
import { createTeamClient } from './stomp.js';

const ACTIVE_WINDOW_MS = 90 * 1000; // 90s 안에 활동 있으면 active

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

export default function App() {
  const [me, setMe] = useState(session.load());
  const [teams, setTeams] = useState([]);
  const [activeTeam, setActiveTeam] = useState(null);
  const [members, setMembers] = useState([]);
  const [feed, setFeed] = useState([]);
  const [activity, setActivity] = useState({}); // userId → {promptFirstLine, todayTokens, todayDurationSec, lastSeen}
  const [agentState, setAgentState] = useState(null);
  const [error, setError] = useState(null);

  const deviceId = useDeviceId();

  // 로그인 후 팀 목록
  useEffect(() => {
    if (!me) return;
    (async () => {
      try {
        const ts = await listMyTeams(me.token);
        setTeams(ts);
        if (ts.length > 0 && !activeTeam) setActiveTeam(ts[0]);
      } catch (e) { setError(e.message); }
    })();
  }, [me]);

  // 활성 팀 변경 시 멤버 로드
  useEffect(() => {
    if (!me || !activeTeam) return;
    (async () => {
      try {
        const ms = await listTeamMembers(me.token, activeTeam.id);
        setMembers(ms);
      } catch (e) { setError(e.message); }
    })();
  }, [me, activeTeam]);

  // 활성 팀 STOMP 구독
  useEffect(() => {
    if (!me || !activeTeam) return;
    const dispose = createTeamClient({
      token: me.token,
      teamCode: activeTeam.teamCode,
      onMessage: (msg) => {
        setFeed((prev) => [{ ...msg, _ts: Date.now() }, ...prev].slice(0, 30));
        setActivity((prev) => ({
          ...prev,
          [msg.userId]: {
            promptFirstLine: msg.promptFirstLine ?? prev[msg.userId]?.promptFirstLine ?? null,
            todayTokens: msg.todayTokens,
            todayDurationSec: msg.todayDurationSec,
            lastSeen: Date.now(),
            event: msg.event,
            toolName: msg.toolName,
            displayName: msg.displayName,
          },
        }));
      },
    });
    return dispose;
  }, [me, activeTeam]);

  // 로컬 에이전트 상태 폴링
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
    return <Login deviceId={deviceId} onLoggedIn={(s) => { session.save(s); setMe(s); }} setError={setError} error={error} />;
  }

  if (teams.length === 0) {
    return <TeamSetup
      token={me.token}
      onTeamReady={(t) => { setTeams([t]); setActiveTeam(t); }}
      setError={setError} error={error}
    />;
  }

  return (
    <div className="app">
      <Topbar
        me={me}
        team={activeTeam}
        agent={agentState}
        onPrivacyToggle={async () => {
          const next = !agentState?.state?.isPrivate;
          await setAgentPrivacy(next);
          const r = await getAgentState();
          setAgentState(r);
        }}
        onLogout={() => { session.clear(); setMe(null); setTeams([]); setActiveTeam(null); setActivity({}); setFeed([]); }}
      />
      <FriendGrid members={members} activity={activity} myUserId={me.userId} />
      <FeedList feed={feed} />
    </div>
  );
}

function Login({ deviceId, onLoggedIn, setError, error }) {
  const [name, setName] = useState('');
  const [backend, setBackend] = useState(getBackendUrl());
  const [busy, setBusy] = useState(false);
  return (
    <div className="app">
      <div className="topbar"><h1>모하니 — 친구가 뭐하나 보기</h1></div>
      <div className="center">
        <div className="card">
          <h2>처음 시작하기</h2>
          <p className="hint">익명 가입 — 이름은 친구한테 보일 닉네임이에요.</p>
          <label>닉네임</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="화소" />
          <label>백엔드 URL</label>
          <input value={backend} onChange={(e) => setBackend(e.target.value)} />
          <div className="actions">
            <button className="btn" disabled={!name || busy} onClick={async () => {
              setBusy(true); setError(null);
              try {
                setBackendUrl(backend);
                const r = await loginAnonymous(deviceId, name);
                onLoggedIn(r);
              } catch (e) { setError(e.message); } finally { setBusy(false); }
            }}>{busy ? '...' : '시작하기'}</button>
          </div>
          {error && <div className="error">{error}</div>}
          <p className="hint">device: {deviceId.slice(0, 8)}…</p>
        </div>
      </div>
    </div>
  );
}

function TeamSetup({ token, onTeamReady, setError, error }) {
  const [tab, setTab] = useState('create');
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="app">
      <div className="topbar"><h1>모하니</h1></div>
      <div className="center">
        <div className="card">
          <h2>팀 만들기 또는 가입</h2>
          <div className="actions" style={{ marginTop: 0, marginBottom: 16 }}>
            <button className={`btn ${tab === 'create' ? '' : 'secondary'}`} onClick={() => setTab('create')}>새 팀 만들기</button>
            <button className={`btn ${tab === 'join' ? '' : 'secondary'}`} onClick={() => setTab('join')}>코드로 가입</button>
          </div>
          {tab === 'create' ? (
            <>
              <label>팀 이름</label>
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="우리 사이드프로젝트팀" />
              <div className="actions">
                <button className="btn" disabled={!teamName || busy} onClick={async () => {
                  setBusy(true); setError(null);
                  try { onTeamReady(await createTeam(token, teamName)); }
                  catch (e) { setError(e.message); } finally { setBusy(false); }
                }}>만들기</button>
              </div>
            </>
          ) : (
            <>
              <label>팀 코드 (6자리)</label>
              <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} />
              <div className="actions">
                <button className="btn" disabled={code.length !== 6 || busy} onClick={async () => {
                  setBusy(true); setError(null);
                  try { onTeamReady(await joinTeam(token, code)); }
                  catch (e) { setError(e.message); } finally { setBusy(false); }
                }}>가입</button>
              </div>
            </>
          )}
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function Topbar({ me, team, agent, onPrivacyToggle, onLogout }) {
  const isPrivate = agent?.state?.isPrivate;
  const agentOk = agent != null;
  return (
    <div className="topbar">
      <h1>모하니</h1>
      <span className="team-info">팀 <code>{team?.teamCode}</code> · {team?.name}</span>
      <span className={`badge ${agentOk ? 'live' : ''}`}>{agentOk ? `agent :${agent.port}` : 'agent off'}</span>
      {isPrivate && <span className="badge private">비공개</span>}
      <div className="grow" />
      <span className="badge">{me.displayName}</span>
      <button className={`toggle ${isPrivate ? 'on' : ''}`} onClick={onPrivacyToggle}>
        {isPrivate ? '비공개 해제' : '비공개 모드'}
      </button>
      <button className="toggle" onClick={onLogout}>로그아웃</button>
    </div>
  );
}

function FriendGrid({ members, activity, myUserId }) {
  return (
    <div className="grid">
      {members.map((m) => {
        const a = activity[m.userId];
        const active = a && Date.now() - a.lastSeen < ACTIVE_WINDOW_MS;
        const tokens = a?.todayTokens ?? 0;
        const minutes = Math.round((a?.todayDurationSec ?? 0) / 60);
        return (
          <div key={m.userId} className={`member-card ${active ? 'active' : 'idle'}`}>
            <div className="name">{m.displayName}{m.userId === myUserId ? ' (나)' : ''}</div>
            <div className="prompt">{a?.promptFirstLine || (active ? '...' : '아직 활동 없음')}</div>
            <div className="stats">
              <span>오늘 {tokens.toLocaleString()} tok</span>
              <span>{minutes}분</span>
              {a?.toolName && <span>도구 {a.toolName}</span>}
            </div>
            <div className="meta">userId={m.userId}</div>
          </div>
        );
      })}
    </div>
  );
}

function FeedList({ feed }) {
  return (
    <div className="feed">
      {feed.length === 0 && <div className="feed-item">아직 활동 없음 — Claude Code에서 첫 프롬프트를 입력해보세요.</div>}
      {feed.map((f, i) => (
        <div key={i} className="feed-item">
          <span className="who">{f.displayName}</span>
          {' · '}
          {f.event}
          {f.promptFirstLine ? `: ${f.promptFirstLine}` : ''}
          {f.toolName ? ` · ${f.toolName}` : ''}
        </div>
      ))}
    </div>
  );
}
