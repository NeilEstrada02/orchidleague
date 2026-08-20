import { useEffect, useState } from 'react'
import './App.css'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || ''

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

  const refreshAll = () => Promise.all([fetchMe(), fetchLeague(), fetchTeams()])

  useEffect(() => {
    Promise.all([fetchMe(), fetchLeague(), fetchTeams()]).finally(() => setLoading(false))

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
      if (!res.ok) throw new Error('enroll failed')
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
        setError(data.error === 'team_already_full' ? 'Your team already has 2 members.' : 'Could not add that player.')
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
      if (!res.ok) throw new Error('remove failed')
      await refreshAll()
    } catch {
      setError('Could not remove that player.')
    } finally {
      setMemberBusyId(null)
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
      if (!res.ok) throw new Error('save failed')
      await refreshAll()
    } catch {
      setError('Could not save team info.')
    } finally {
      setSavingInfo(false)
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

  return (
    <div className="landing">
      <div className="stack">
        <div className="card">
          <h1>Orchid League</h1>
          {loading ? (
            <p className="subtitle">Loading...</p>
          ) : user ? (
            <>
              <p className="greeting">Welcome, {user.displayName}!</p>
              <label className="enroll-toggle">
                <input type="checkbox" checked={user.enrolled} disabled={busy} onChange={handleToggleEnroll} />
                Enroll in the League
              </label>
              {user.enrolled && (
                <label className="enroll-toggle">
                  <input type="checkbox" checked={user.isCaptain} disabled={busy} onChange={handleToggleCaptain} />
                  I am the Team Captain
                </label>
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

        {user?.isCaptain && user.team && (
          <div className="card roster-card">
            <h2>Your Team</h2>

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
                onChange={(e) => setCharityDraft(e.target.value)}
                placeholder="Charity this team is playing for"
              />
              <button className="secondary-btn save-btn" disabled={savingInfo} onClick={handleSaveTeamInfo}>
                {savingInfo ? 'Saving...' : 'Save'}
              </button>
            </div>

            <ul className="roster-list">
              <li className="team-slot captain-slot">{user.displayName} (Captain)</li>
              {user.team.members.map((m) => (
                <li key={m.id} className="team-slot">
                  {m.displayName}
                  <button
                    className="link-btn"
                    disabled={memberBusyId === m.id}
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
                          disabled={memberBusyId === c.id}
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
                      {member.displayName}
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
                      <strong>{teamLabel(team)}</strong>
                      <span className="subtitle">Captain: {team.captainName}</span>
                      <span className="subtitle">
                        {team.members.length === 0
                          ? 'no teammates yet'
                          : team.members.map((m) => m.displayName).join(', ')}
                      </span>
                      {team.charity && <span className="subtitle">Playing for: {team.charity}</span>}
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
                      <tr key={team.captainId}>
                        <td>{teamLabel(team)}</td>
                        <td>{team.wins}</td>
                        <td>{team.losses}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
