import { useEffect, useState } from 'react'
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || ''
const SEATS = ['pioneer', 'modern', 'standard']
const SEAT_LABELS = { pioneer: 'Pioneer', modern: 'Modern', standard: 'Standard' }

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [league, setLeague] = useState([])
  const [teams, setTeams] = useState([])
  const [busy, setBusy] = useState(false)
  const [memberBusyId, setMemberBusyId] = useState(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('roster')
  const [teamNameDraft, setTeamNameDraft] = useState('')
  const [charityDraft, setCharityDraft] = useState('')
  const [savingInfo, setSavingInfo] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [dragSeat, setDragSeat] = useState(null)
  const [selectedSeat, setSelectedSeat] = useState(null)
  const [settings, setSettings] = useState({ signupsOpen: true, dummyAccountsEnabled: false })
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [pairings, setPairings] = useState([])
  const [decklistsData, setDecklistsData] = useState({ round: null, formats: { pioneer: [], modern: [], standard: [] } })
  const [roundBusy, setRoundBusy] = useState(false)
  const [reportBusyId, setReportBusyId] = useState(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [dummyBusy, setDummyBusy] = useState(false)
  const [decklistDraft, setDecklistDraft] = useState('')
  const [decklistSaving, setDecklistSaving] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const fetchMe = () =>
    fetch(`${SERVER_URL}/api/me`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setUser(data.user))
      .catch(() => setUser(null))

  const fetchLeague = () =>
    fetch(`${SERVER_URL}/api/league`)
      .then((res) => res.json())
      .then((data) => setLeague(data.users ?? []))
      .catch(() => {})

  const fetchTeams = () =>
    fetch(`${SERVER_URL}/api/teams`)
      .then((res) => res.json())
      .then((data) => setTeams(data.teams ?? []))
      .catch(() => {})

  const fetchSettings = () =>
    fetch(`${SERVER_URL}/api/settings`)
      .then((res) => res.json())
      .then((data) => setSettings(data.settings ?? { signupsOpen: true, dummyAccountsEnabled: false }))
      .catch(() => {})

  const fetchPairings = () =>
    fetch(`${SERVER_URL}/api/pairings`)
      .then((res) => res.json())
      .then((data) => setPairings(data.rounds ?? []))
      .catch(() => {})

  const fetchDecklists = () =>
    fetch(`${SERVER_URL}/api/decklists`)
      .then((res) => res.json())
      .then((data) => setDecklistsData(data ?? { round: null, formats: { pioneer: [], modern: [], standard: [] } }))
      .catch(() => {})

  const refreshAll = () =>
    Promise.all([fetchMe(), fetchLeague(), fetchTeams(), fetchSettings(), fetchPairings(), fetchDecklists()])

  useEffect(() => {
    Promise.all([fetchMe(), fetchLeague(), fetchTeams(), fetchSettings(), fetchPairings(), fetchDecklists()]).finally(() =>
      setLoading(false)
    )

    const params = new URLSearchParams(window.location.search)
    const err = params.get('error')
    if (err === 'not_in_server') {
      setLoginError('You must be a member of the Orchid League Discord server to log in.')
    } else if (err) {
      setLoginError('Something went wrong signing you in. Please try again.')
    }
    if (err) {
      params.delete('error')
      const rest = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''))
    }
  }, [])

  // Seed the editable draft fields once, when the captain panel first appears.
  useEffect(() => {
    if (user?.team) {
      setTeamNameDraft(user.team.teamName)
      setCharityDraft(user.team.charity)
    }
  }, [user?.team?.captainId])

  // Seed the decklist draft once, when the user first logs in.
  useEffect(() => {
    if (user) setDecklistDraft(user.decklist ?? '')
  }, [user?.id])

  // Tick the clock for the round countdown.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const handleLogout = async () => {
    await fetch(`${SERVER_URL}/auth/logout`, { method: 'POST', credentials: 'include' })
    setUser(null)
  }

  const handleToggleEnroll = async (e) => {
    const nextEnrolled = e.target.checked
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/enroll`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrolled: nextEnrolled }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error === 'signups_closed' ? 'Signups are currently closed.' : 'Could not update enrollment.')
        return
      }
      await refreshAll()
    } catch {
      setError('Could not update enrollment.')
    } finally {
      setBusy(false)
    }
  }

  const handleToggleCaptain = async (e) => {
    const nextCaptain = e.target.checked
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/captain`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captain: nextCaptain }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'already_a_team_member') {
          setError("You're already on another captain's team, so you can't also be a captain.")
        } else if (data.error === 'signups_closed') {
          setError('Signups are currently closed.')
        } else {
          setError('Could not update captain status.')
        }
        return
      }
      await refreshAll()
    } catch {
      setError('Could not update captain status.')
    } finally {
      setBusy(false)
    }
  }

  const handleAddMember = async (memberId) => {
    setMemberBusyId(memberId)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/team/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, action: 'add' }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'team_already_full') {
          setError('Your team already has 2 members.')
        } else if (data.error === 'signups_closed') {
          setError('Signups are currently closed.')
        } else {
          setError('Could not add that player.')
        }
        return
      }
      await refreshAll()
    } catch {
      setError('Could not add that player.')
    } finally {
      setMemberBusyId(null)
    }
  }

  const handleRemoveMember = async (memberId) => {
    setMemberBusyId(memberId)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/team/members`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, action: 'remove' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error === 'signups_closed' ? 'Signups are currently closed.' : 'Could not remove that player.')
        return
      }
      await refreshAll()
    } catch {
      setError('Could not remove that player.')
    } finally {
      setMemberBusyId(null)
    }
  }

  const handleSwapSeats = async (seatA, seatB) => {
    if (seatA === seatB) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/team/seats/swap`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatA, seatB }),
      })
      if (!res.ok) throw new Error('swap failed')
      await refreshAll()
    } catch {
      setError('Could not swap those seats.')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveTeamInfo = async () => {
    setSavingInfo(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/team/info`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamName: teamNameDraft, charity: charityDraft }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error === 'signups_closed' ? 'Signups are currently closed.' : 'Could not save team info.')
        return
      }
      await refreshAll()
    } catch {
      setError('Could not save team info.')
    } finally {
      setSavingInfo(false)
    }
  }

  const handleSaveDecklist = async () => {
    setDecklistSaving(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/decklist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: decklistDraft }),
      })
      if (!res.ok) throw new Error('save failed')
      await refreshAll()
    } catch {
      setError('Could not save your decklist.')
    } finally {
      setDecklistSaving(false)
    }
  }

  const handleToggleSignups = async () => {
    setSettingsBusy(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/settings`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signupsOpen: !settings.signupsOpen }),
      })
      if (!res.ok) throw new Error('toggle failed')
      await refreshAll()
    } catch {
      setError('Could not update signup status.')
    } finally {
      setSettingsBusy(false)
    }
  }

  const handleAdvanceRound = async () => {
    const current = pairings[0]
    const message = !current
      ? 'Start Round 1? This will generate pairings for all eligible teams.'
      : current.status === 'open'
        ? `Close Round ${current.number} and start Round ${current.number + 1}? Anyone who hasn't reported a result will be given a loss.`
        : `Start Round ${current.number + 1}?`
    if (!window.confirm(message)) return

    setRoundBusy(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/pairings/advance`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error === 'not_enough_teams' ? 'Need at least 2 full teams to generate pairings.' : 'Could not advance the round.')
        return
      }
      await refreshAll()
    } catch {
      setError('Could not advance the round.')
    } finally {
      setRoundBusy(false)
    }
  }

  const handleReportResult = async (pairingId, outcome) => {
    setReportBusyId(pairingId)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/pairings/report`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingId, outcome }),
      })
      if (!res.ok) throw new Error('report failed')
      await refreshAll()
    } catch {
      setError('Could not report that result.')
    } finally {
      setReportBusyId(null)
    }
  }

  const handleResetSeason = async () => {
    const confirmed = window.confirm(
      'Reset all standings? This permanently clears every round, pairing, and win/loss record for the entire league. This cannot be undone.'
    )
    if (!confirmed) return

    setResetBusy(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/reset-standings`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error('reset failed')
      await refreshAll()
    } catch {
      setError('Could not reset standings.')
    } finally {
      setResetBusy(false)
    }
  }

  const handleToggleDummyAccounts = async () => {
    const next = !settings.dummyAccountsEnabled
    const message = next
      ? 'Add 14 dummy test accounts and 3 pre-built teams to the league for testing?'
      : 'Remove all dummy test accounts and their teams? This cannot be undone.'
    if (!window.confirm(message)) return

    setDummyBusy(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/dummy-accounts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
      if (!res.ok) throw new Error('toggle failed')
      await refreshAll()
    } catch {
      setError('Could not update test accounts.')
    } finally {
      setDummyBusy(false)
    }
  }

  const candidates = user
    ? league.filter((member) => member.id !== user.id && !member.isCaptain && !member.onTeam)
    : []

  const standings = [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.losses !== b.losses) return a.losses - b.losses
    return a.captainName.localeCompare(b.captainName)
  })

  const teamLabel = (team) => team.teamName || `${team.captainName}'s Team`

  const nextRoundAtMs = settings.nextRoundAt ? new Date(settings.nextRoundAt).getTime() : null
  const countdownMs = nextRoundAtMs ? Math.max(0, nextRoundAtMs - now) : null
  const countdownLabel = (() => {
    if (countdownMs === null) return ''
    const totalSeconds = Math.floor(countdownMs / 1000)
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60
    if (days > 0) return `${days}d ${hours}h ${minutes}m`
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
    return `${minutes}m ${seconds}s`
  })()
  const nextRoundAtLabel = nextRoundAtMs
    ? new Date(nextRoundAtMs).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''

  const formatBySeat = {}
  teams.forEach((t) => {
    SEATS.forEach((seat) => {
      const occ = t.seats?.[seat]
      if (occ) formatBySeat[occ.id] = seat
    })
  })
  const formatClass = (personId) => (formatBySeat[personId] ? `format-${formatBySeat[personId]}` : '')

  const currentRound = pairings[0]
  const advanceRoundLabel = !currentRound
    ? 'Start Round 1'
    : currentRound.status === 'open'
      ? `Close Round ${currentRound.number} & Start Round ${currentRound.number + 1}`
      : `Start Round ${currentRound.number + 1}`

  const pairingResultLabel = (p) => {
    if (!p.teamB) return `${p.teamA.name} — Bye`
    if (p.result === 'A') return `${p.teamA.name} won`
    if (p.result === 'B') return `${p.teamB.name} won`
    if (p.result === 'double-loss') return 'No result reported — both teams lost'
    return 'Pending'
  }

  return (
    <div className="landing">
      <div className="stack">
        <div className="card">
          <img src="/logo.png" alt="Orchid League" className="site-logo" />
          <h1>Orchid League</h1>
          {nextRoundAtMs && (
            <p className="countdown-text">
              ⏳ Next round {countdownMs === 0 ? 'starting any moment' : `in ${countdownLabel}`}
              <br />
              <span className="countdown-sub">{nextRoundAtLabel}</span>
            </p>
          )}
          {!settings.signupsOpen && <p className="closed-banner">🔒 Signups are currently closed.</p>}
          {loading ? (
            <p className="subtitle">Loading...</p>
          ) : user ? (
            <>
              <p className="greeting">Welcome, {user.displayName}!</p>
              <label className="enroll-toggle">
                <input
                  type="checkbox"
                  checked={user.enrolled}
                  disabled={busy || !settings.signupsOpen}
                  onChange={handleToggleEnroll}
                />
                Enroll in the League
              </label>
              {user.enrolled && (
                <label className="enroll-toggle">
                  <input
                    type="checkbox"
                    checked={user.isCaptain}
                    disabled={busy || !settings.signupsOpen}
                    onChange={handleToggleCaptain}
                  />
                  I am the Team Captain
                </label>
              )}
              {user.isAdmin && (
                <div className="admin-panel">
                  <span className="field-label">Admin</span>
                  <button className="secondary-btn" disabled={settingsBusy} onClick={handleToggleSignups}>
                    {settings.signupsOpen ? 'Close Signups' : 'Open Signups'}
                  </button>
                  <button className="secondary-btn" disabled={roundBusy} onClick={handleAdvanceRound}>
                    {advanceRoundLabel}
                  </button>
                  <button className="secondary-btn danger-btn" disabled={resetBusy} onClick={handleResetSeason}>
                    Reset All Standings
                  </button>
                  <button className="secondary-btn" disabled={dummyBusy} onClick={handleToggleDummyAccounts}>
                    {settings.dummyAccountsEnabled ? 'Remove Test Accounts' : 'Add Test Accounts'}
                  </button>
                </div>
              )}
              {error && <p className="error-text">{error}</p>}
              <button className="secondary-btn" onClick={handleLogout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <p className="subtitle">Sign in with Discord to get started.</p>
              {loginError && <p className="error-text">{loginError}</p>}
              <a className="discord-btn" href={`${SERVER_URL}/auth/discord`}>
                Login with Discord
              </a>
            </>
          )}
        </div>

        {user?.enrolled && (
          <div className="card roster-card">
            <h2>My Decklist</h2>
            <p className="subtitle seat-hint">
              Paste your decklist here. Edits only apply starting next round — whatever's saved when a round is
              generated is what's shown for that round.
            </p>
            <textarea
              className="text-input textarea-input"
              value={decklistDraft}
              maxLength={5000}
              placeholder="Paste your decklist..."
              onChange={(e) => setDecklistDraft(e.target.value)}
            />
            <button
              className="secondary-btn save-btn"
              disabled={decklistSaving}
              onClick={handleSaveDecklist}
            >
              {decklistSaving ? 'Saving...' : 'Save Decklist'}
            </button>
          </div>
        )}

        {user?.isCaptain && user.team && (
          <div className="card roster-card">
            <h2>Your Team</h2>
            {user.team.eliminated && (
              <p className="closed-banner">❌ Your team has been eliminated (3 losses) and will not receive future pairings.</p>
            )}

            <div className="field-group">
              <label className="field-label" htmlFor="teamName">
                Team Name
              </label>
              <input
                id="teamName"
                className="text-input"
                type="text"
                maxLength={60}
                value={teamNameDraft}
                disabled={!settings.signupsOpen}
                onChange={(e) => setTeamNameDraft(e.target.value)}
                placeholder={`${user.displayName}'s Team`}
              />
              <label className="field-label" htmlFor="charity">
                Charity
              </label>
              <input
                id="charity"
                className="text-input"
                type="text"
                maxLength={80}
                value={charityDraft}
                disabled={!settings.signupsOpen}
                onChange={(e) => setCharityDraft(e.target.value)}
                placeholder="Charity this team is playing for"
              />
              <button
                className="secondary-btn save-btn"
                disabled={savingInfo || !settings.signupsOpen}
                onClick={handleSaveTeamInfo}
              >
                {savingInfo ? 'Saving...' : 'Save'}
              </button>
            </div>

            <ul className="roster-list">
              <li className="team-slot captain-slot">
                <span className={formatClass(user.id)}>{user.displayName}</span> (Captain)
              </li>
              {user.team.members.map((m) => (
                <li key={m.id} className="team-slot">
                  <span className={formatClass(m.id)}>{m.displayName}</span>
                  <button
                    className="link-btn"
                    disabled={memberBusyId === m.id || !settings.signupsOpen}
                    onClick={() => handleRemoveMember(m.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
              {Array.from({ length: 2 - user.team.members.length }).map((_, i) => (
                <li key={`empty-${i}`} className="team-slot empty-slot">
                  Open slot
                </li>
              ))}
            </ul>

            {user.team.members.length === 2 && (
              <>
                <h2 className="sub-heading">Seat Assignments</h2>
                <p className="subtitle seat-hint">Drag a player onto another seat to swap them (or tap one, then tap another).</p>
                <p className="subtitle seat-hint">
                  ℹ️ Swaps only affect future rounds — your team's matchups for the current round are already locked in and won't change.
                </p>
                <div className="seat-grid">
                  {SEATS.map((seat) => {
                    const occupant = user.team.seats?.[seat] ?? null
                    const isSelected = selectedSeat === seat
                    return (
                      <div
                        key={seat}
                        className={`seat-card ${isSelected ? 'seat-selected' : ''}`}
                        draggable={!busy}
                        onDragStart={() => setDragSeat(seat)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (dragSeat && dragSeat !== seat) handleSwapSeats(dragSeat, seat)
                          setDragSeat(null)
                        }}
                        onClick={() => {
                          if (busy) return
                          if (selectedSeat === null) {
                            setSelectedSeat(seat)
                          } else if (selectedSeat === seat) {
                            setSelectedSeat(null)
                          } else {
                            handleSwapSeats(selectedSeat, seat)
                            setSelectedSeat(null)
                          }
                        }}
                      >
                        <div className="seat-label">{SEAT_LABELS[seat]}</div>
                        <div className={`seat-occupant format-${seat}`}>{occupant?.displayName ?? '—'}</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {user.team.members.length < 2 && (
              <>
                <h2 className="sub-heading">Add a Teammate</h2>
                {candidates.length === 0 ? (
                  <p className="subtitle">No eligible players available right now.</p>
                ) : (
                  <ul className="roster-list">
                    {candidates.map((c) => (
                      <li key={c.id} className="team-slot">
                        {c.displayName}
                        <button
                          className="link-btn"
                          disabled={memberBusyId === c.id || !settings.signupsOpen}
                          onClick={() => handleAddMember(c.id)}
                        >
                          Add
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        <div className="card roster-card wide-card">
          <div className="tab-bar">
            <button
              className={`tab-btn ${activeTab === 'roster' ? 'active' : ''}`}
              onClick={() => setActiveTab('roster')}
            >
              Roster
            </button>
            <button
              className={`tab-btn ${activeTab === 'teams' ? 'active' : ''}`}
              onClick={() => setActiveTab('teams')}
            >
              Teams
            </button>
            <button
              className={`tab-btn ${activeTab === 'standings' ? 'active' : ''}`}
              onClick={() => setActiveTab('standings')}
            >
              Standings
            </button>
            <button
              className={`tab-btn ${activeTab === 'pairings' ? 'active' : ''}`}
              onClick={() => setActiveTab('pairings')}
            >
              Pairings
            </button>
            <button
              className={`tab-btn ${activeTab === 'decklists' ? 'active' : ''}`}
              onClick={() => setActiveTab('decklists')}
            >
              Decklists
            </button>
            <button
              className={`tab-btn ${activeTab === 'rules' ? 'active' : ''}`}
              onClick={() => setActiveTab('rules')}
            >
              Rules
            </button>
          </div>

          {activeTab === 'roster' && (
            <>
              <h2>League Roster</h2>
              {league.length === 0 ? (
                <p className="subtitle">No one has enrolled yet.</p>
              ) : (
                <ul className="roster-list">
                  {league.map((member) => (
                    <li key={member.id}>
                      {member.isAdmin && <span title="Admin">👑 </span>}
                      {member.isCaptain && <span title="Captain">🧑‍✈️ </span>}
                      <span className={formatClass(member.id)}>{member.displayName}</span>
                      {member.isCaptain && <span className="tag">Captain</span>}
                      {!member.isCaptain && member.onTeam && <span className="tag">On a team</span>}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {activeTab === 'teams' && (
            <>
              <h2>Teams</h2>
              {teams.length === 0 ? (
                <p className="subtitle">No teams have been formed yet.</p>
              ) : (
                <ul className="roster-list">
                  {teams.map((team) => (
                    <li key={team.captainId} className="team-row">
                      <strong>
                        {teamLabel(team)}
                        {team.eliminated && <span className="tag tag-eliminated">Eliminated</span>}
                      </strong>
                      <span className="subtitle">
                        Captain: <span className={formatClass(team.captainId)}>{team.captainName}</span>
                      </span>
                      <span className="subtitle">
                        {team.members.length === 0 ? (
                          'no teammates yet'
                        ) : (
                          team.members.map((m, idx) => (
                            <span key={m.id}>
                              <span className={formatClass(m.id)}>{m.displayName}</span>
                              {idx < team.members.length - 1 ? ', ' : ''}
                            </span>
                          ))
                        )}
                      </span>
                      {team.charity && <span className="subtitle">Playing for: {team.charity}</span>}
                      {(team.seats?.pioneer || team.seats?.modern || team.seats?.standard) && (
                        <span className="subtitle">
                          Pioneer: <span className="format-pioneer">{team.seats.pioneer?.displayName ?? '—'}</span> · Modern:{' '}
                          <span className="format-modern">{team.seats.modern?.displayName ?? '—'}</span> · Standard:{' '}
                          <span className="format-standard">{team.seats.standard?.displayName ?? '—'}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {activeTab === 'standings' && (
            <>
              <h2>Standings</h2>
              {standings.length === 0 ? (
                <p className="subtitle">No teams have been formed yet.</p>
              ) : (
                <table className="standings-table">
                  <thead>
                    <tr>
                      <th>Team</th>
                      <th>W</th>
                      <th>L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((team) => (
                      <tr key={team.captainId} className={team.eliminated ? 'standings-eliminated' : ''}>
                        <td>
                          {team.eliminated && <span title="Eliminated">❌ </span>}
                          <span className={team.eliminated ? 'eliminated-name' : ''}>{teamLabel(team)}</span>
                          {team.eliminated && <span className="tag tag-eliminated">Eliminated</span>}
                        </td>
                        <td>{team.wins}</td>
                        <td>{team.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {activeTab === 'pairings' && (
            <>
              <h2>Pairings</h2>
              <p className="subtitle seat-hint">See the Decklists tab for this round's decklists.</p>
              {pairings.length === 0 ? (
                <p className="subtitle">No rounds have been played yet.</p>
              ) : (
                pairings.map((round) => (
                  <div key={round.number} className="round-block">
                    <h3 className="round-heading">
                      Round {round.number}
                      {round.status === 'open' && <span className="tag">Current</span>}
                    </h3>
                    <ul className="roster-list">
                      {round.pairings.map((p) => {
                        const mine =
                          user &&
                          user.myTeamCaptainId &&
                          (p.teamA.captainId === user.myTeamCaptainId || p.teamB?.captainId === user.myTeamCaptainId)
                        const canReport = mine && round.status === 'open' && p.teamB && !p.result
                        return (
                          <li key={p.id} className={`pairing-row ${mine ? 'pairing-mine' : ''}`}>
                            <div className="pairing-teams">
                              {p.teamA.name}
                              {p.teamB ? ` vs ${p.teamB.name}` : ''}
                            </div>
                            {p.matchups.length > 0 && (
                              <ul className="matchup-list">
                                {p.matchups.map((m) => (
                                  <li key={m.seat} className="matchup-row">
                                    <span className="matchup-format">{SEAT_LABELS[m.seat]}:</span>{' '}
                                    <span className={`format-${m.seat}`}>{m.playerA?.displayName ?? 'TBD'}</span>
                                    {' vs '}
                                    <span className={`format-${m.seat}`}>{m.playerB?.displayName ?? 'TBD'}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="subtitle pairing-status">{pairingResultLabel(p)}</div>
                            {canReport && (
                              <div className="pairing-actions">
                                <button
                                  className="link-btn"
                                  disabled={reportBusyId === p.id}
                                  onClick={() => handleReportResult(p.id, 'win')}
                                >
                                  We Won
                                </button>
                                <button
                                  className="link-btn"
                                  disabled={reportBusyId === p.id}
                                  onClick={() => handleReportResult(p.id, 'loss')}
                                >
                                  We Lost
                                </button>
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))
              )}
            </>
          )}

          {activeTab === 'decklists' && (
            <>
              <h2>Decklists</h2>
              {decklistsData.round === null ? (
                <p className="subtitle">No round is currently in progress.</p>
              ) : (
                <>
                  <p className="subtitle seat-hint">Decklists locked in for Round {decklistsData.round}.</p>
                  {['standard', 'modern', 'pioneer'].map((seat) => (
                    <div key={seat} className="decklist-format-section">
                      <h3 className={`decklist-format-heading format-${seat}`}>{SEAT_LABELS[seat]}</h3>
                      {decklistsData.formats[seat].length === 0 ? (
                        <p className="subtitle">No one seated here this round.</p>
                      ) : (
                        <ul className="roster-list">
                          {decklistsData.formats[seat].map((entry) => (
                            <li key={entry.playerId} className="decklist-entry">
                              <div className="decklist-entry-header">
                                <span className={`format-${seat}`}>{entry.playerName}</span>
                                <span className="subtitle">
                                  {' '}
                                  ({entry.teamName}){entry.opponentName ? ` vs ${entry.opponentName}` : ' — Bye'}
                                </span>
                              </div>
                              {entry.decklist ? (
                                <details className="decklist-details">
                                  <summary>View Decklist</summary>
                                  <pre className="decklist-text">{entry.decklist}</pre>
                                </details>
                              ) : (
                                <span className="subtitle">No decklist submitted.</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {activeTab === 'rules' && (
            <>
              <h2>Rules</h2>
              <ul className="rules-list">
                <li>
                  <strong>Entry Fee:</strong> Each team captain must Venmo{' '}
                  <a className="rules-link" href="https://venmo.com/neil-estrada-2" target="_blank" rel="noreferrer">
                    @neil-estrada-2
                  </a>{' '}
                  $30 for the entry fee. All entry fees will be donated to the charity of the winning team's choice.
                </li>
                <li>
                  <strong>Elimination:</strong> Teams play until they accumulate 3 losses, at which point they are
                  eliminated.
                </li>
                <li>
                  <strong>Top Cut:</strong> There will be a top cut to the top N teams (likely 4 or 2) depending on
                  team count.
                </li>
                <li>
                  <strong>Platforms:</strong> The <span className="format-standard">Standard</span> and{' '}
                  <span className="format-pioneer">Pioneer</span> seats must play all matches on Magic Arena. The{' '}
                  <span className="format-modern">Modern</span> seat must play all matches on MTGO.
                </li>
                <li>
                  <strong>No Draws:</strong> No draws, intentional or otherwise. If you fail to submit your result
                  for the week, both teams receive a loss.
                </li>
                <li>
                  <strong>Match Settings:</strong> Use the tournament settings on Magic Arena, and a 25-minute timer
                  on Magic Online. Both sides can agree to play without a timer, only if they want to.
                </li>
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
