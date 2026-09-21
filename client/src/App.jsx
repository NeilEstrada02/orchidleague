import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { DeckView, LazyDetails } from './DeckView.jsx'
import { cardKey } from './decklist.js'

const SERVER_URL = import.meta.env.VITE_SERVER_URL || ''
const SEATS = ['pioneer', 'modern', 'standard']
const SEAT_LABELS = { pioneer: 'Pioneer', modern: 'Modern', standard: 'Standard' }
const TAB_IDS = ['home', 'myteam', 'pairings', 'standings', 'teams', 'decklists', 'roster', 'halloffame', 'rules', 'admin']

const HALL_OF_FAME = [
  { season: 3, champion: 'Curve Fillers', members: ['Neil Estrada', 'Liam Etelson', 'Zev Goldhaber-Gordon'] },
  { season: 2, champion: 'Frank Kaner', handle: '@_adlai' },
  { season: 1, champion: 'Julian Weiswasser', handle: '@selfcongrats' },
]

const tabFromHash = () => {
  const id = window.location.hash.replace('#', '')
  return TAB_IDS.includes(id) ? id : 'home'
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [league, setLeague] = useState([])
  const [teams, setTeams] = useState([])
  const [busy, setBusy] = useState(false)
  const [memberBusyId, setMemberBusyId] = useState(null)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState(tabFromHash)
  const [selectedRound, setSelectedRound] = useState(null)
  const [decklistFormat, setDecklistFormat] = useState('standard')
  const [decklistFilter, setDecklistFilter] = useState('')
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
  const [reminderSending, setReminderSending] = useState(false)
  const [resultReminderSending, setResultReminderSending] = useState(false)
  const [decklistDraft, setDecklistDraft] = useState('')
  const [decklistSaving, setDecklistSaving] = useState(false)
  const [memberDecklistDrafts, setMemberDecklistDrafts] = useState({})
  const [memberDecklistSaving, setMemberDecklistSaving] = useState(null)
  const [paidBusyId, setPaidBusyId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
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

  // Card details (type, mana cost, image) for rendering decklists, shared by
  // every deck on screen and fetched only for cards not asked about yet.
  const [cardInfo, setCardInfo] = useState({})
  const requestedCards = useRef(new Set())
  const ensureCards = useCallback((names) => {
    const wanted = []
    for (const name of names) {
      const key = cardKey(name)
      if (name.length <= 120 && !requestedCards.current.has(key)) {
        requestedCards.current.add(key)
        wanted.push(name)
      }
    }
    for (let i = 0; i < wanted.length; i += 100) {
      const batch = wanted.slice(i, i + 100)
      fetch(`${SERVER_URL}/api/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: batch }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('card lookup failed')
          return res.json()
        })
        .then((data) => {
          setCardInfo((prev) => ({ ...prev, ...data.cards }))
          for (const key of data.unresolved ?? []) requestedCards.current.delete(key)
        })
        .catch(() => {
          for (const name of batch) requestedCards.current.delete(cardKey(name))
        })
    }
  }, [])

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

  // Keep the current page in the URL hash so refresh, back/forward and shared
  // links land on the same page.
  useEffect(() => {
    const onHashChange = () => setActiveTab(tabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = (tab) => {
    setActiveTab(tab)
    window.location.hash = tab
    window.scrollTo(0, 0)
  }

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

  // Every teammate other than the viewer -- captain included -- each with
  // their current decklist, so anyone on the team can edit anyone else's.
  const teammates = user?.team
    ? [
        { id: user.team.captainId, displayName: user.team.captainName, decklist: user.team.captainDecklist ?? '' },
        ...user.team.members,
      ].filter((t) => t.id !== user.id)
    : []

  // Seed each teammate's decklist draft whenever the roster changes (not on
  // every unrelated refresh, so an in-progress edit isn't clobbered).
  const teamMemberIdsKey = teammates.map((m) => m.id).join(',')
  useEffect(() => {
    if (user?.team) {
      const drafts = {}
      for (const m of teammates) drafts[m.id] = m.decklist ?? ''
      setMemberDecklistDrafts(drafts)
    }
  }, [teamMemberIdsKey])


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
      if (!res.ok) {
        setError('Could not save team info.')
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

  const handleSaveMemberDecklist = async (memberId) => {
    setMemberDecklistSaving(memberId)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/team/member-decklist`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId, text: memberDecklistDrafts[memberId] ?? '' }),
      })
      if (!res.ok) throw new Error('save failed')
      await refreshAll()
    } catch {
      setError("Could not save that teammate's decklist.")
    } finally {
      setMemberDecklistSaving(null)
    }
  }

  const handleCopyDecklist = async (text, id) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  const handleTogglePaid = async (captainId, currentPaid) => {
    setPaidBusyId(captainId)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/team-paid`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captainId, paid: !currentPaid }),
      })
      if (!res.ok) throw new Error('save failed')
      await fetchTeams()
    } catch {
      setError('Could not update paid status.')
    } finally {
      setPaidBusyId(null)
    }
  }

  const handleToggleSignups = async () => {
    const closing = settings.signupsOpen
    if (closing) {
      const confirmed = window.confirm(
        'Close signups? Anyone currently enrolled but not on any team will be removed from the league (and lose the Discord role) as part of closing.'
      )
      if (!confirmed) return
    }

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
      const data = await res.json()
      await refreshAll()
      if (closing && data.removedCount > 0) {
        setError(`Signups closed. Removed ${data.removedCount} teamless player(s) from the league.`)
      }
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
    const confirmed = window.confirm(
      `Report that your team ${outcome === 'win' ? 'WON' : 'LOST'} this match? This can't be changed afterward.`
    )
    if (!confirmed) return
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

  const handleSendDecklistReminder = async () => {
    if (!window.confirm("Post a message in Discord @-mentioning every enrolled player who hasn't submitted a decklist?")) return

    setReminderSending(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/send-decklist-reminder`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        const messages = {
          bot_not_configured: 'Discord bot is not configured yet.',
          channel_not_configured: 'Set a reminder channel ID first.',
          send_failed: 'Discord rejected the message -- check the channel ID and bot permissions.',
        }
        setError(messages[data.error] ?? 'Could not send the reminder.')
        return
      }
      setError(data.sent ? `Reminder sent, mentioning ${data.count} player(s).` : 'Everyone has already submitted a decklist!')
    } catch {
      setError('Could not send the reminder.')
    } finally {
      setReminderSending(false)
    }
  }

  const handleSendResultReminder = async () => {
    if (!window.confirm("Post a message in Discord @-mentioning every member of every team that hasn't reported this round's result yet?")) return

    setResultReminderSending(true)
    setError('')
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/send-result-reminder`, {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) {
        const messages = {
          bot_not_configured: 'Discord bot is not configured yet.',
          send_failed: 'Discord rejected the message -- check the channel and bot permissions.',
        }
        setError(messages[data.error] ?? 'Could not send the reminder.')
        return
      }
      setError(
        data.sent
          ? `Reminder sent for ${data.matchCount} match(es), mentioning ${data.teamCount} team(s).`
          : 'No open round, or everyone has already reported!'
      )
    } catch {
      setError('Could not send the reminder.')
    } finally {
      setResultReminderSending(false)
    }
  }

  const candidates = user
    ? league.filter((member) => member.id !== user.id && !member.isCaptain && !member.onTeam)
    : []

  const standings = [...teams].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins
    if (a.losses !== b.losses) return a.losses - b.losses
    if ((b.omw ?? -1) !== (a.omw ?? -1)) return (b.omw ?? -1) - (a.omw ?? -1)
    return a.captainName.localeCompare(b.captainName)
  })
  const formatOmw = (omw) => (omw === null || omw === undefined ? '—' : `${(omw * 100).toFixed(1)}%`)

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

  // The signed-in user's own seat in a pairing and who they're facing --
  // only their own opponent, never other players on either team.
  const findMyMatchup = (p) => {
    if (!user || !p.teamB) return null
    for (const m of p.matchups) {
      if (m.playerA?.id === user.id) return { seat: m.seat, me: m.playerA, opp: m.playerB, oppTeam: p.teamB.name }
      if (m.playerB?.id === user.id) return { seat: m.seat, me: m.playerB, opp: m.playerA, oppTeam: p.teamA.name }
    }
    return null
  }

  const myCurrentMatch = (() => {
    const round = pairings.find((r) => r.status === 'open')
    if (!round) return null
    for (const p of round.pairings) {
      const mine = findMyMatchup(p)
      if (mine) return { round, pairing: p, mine }
    }
    return null
  })()

  const renderDeckPanel = (title, player, copyKey) => (
    <div className="deck-panel">
      <div className="deck-panel-header">
        <strong>{title}</strong>
        {player?.decklist && (
          <button className="link-btn copy-btn" onClick={() => handleCopyDecklist(player.decklist, copyKey)}>
            {copiedId === copyKey ? 'Copied!' : 'Copy'}
          </button>
        )}
      </div>
      {player?.decklist ? (
        <DeckView text={player.decklist} cardInfo={cardInfo} ensureCards={ensureCards} />
      ) : (
        <span className="subtitle">{player ? 'No decklist submitted.' : 'No opponent seated.'}</span>
      )}
    </div>
  )

  const renderMyDecks = (pairingId, mine) => (
    <div className="deck-grid">
      {renderDeckPanel(`Your deck (${mine.me.displayName})`, mine.me, `${pairingId}-me`)}
      {renderDeckPanel(`${mine.opp?.displayName ?? 'Opponent'}'s deck`, mine.opp, `${pairingId}-opp`)}
    </div>
  )

  const pairingResultLabel = (p) => {
    if (!p.teamB) return `${p.teamA.name} — Bye`
    if (p.result === 'A') return `${p.teamA.name} won`
    if (p.result === 'B') return `${p.teamB.name} won`
    if (p.result === 'double-loss') return 'No result reported — both teams lost'
    return 'Pending'
  }

  const openRound = pairings.find((r) => r.status === 'open') ?? null
  const isMyPairing = (p) =>
    Boolean(user?.myTeamCaptainId && (p.teamA.captainId === user.myTeamCaptainId || p.teamB?.captainId === user.myTeamCaptainId))
  const myPairing = openRound ? (openRound.pairings.find(isMyPairing) ?? null) : null
  const shownRound = pairings.find((r) => r.number === selectedRound) ?? pairings[0] ?? null
  const myTeamName = user?.team ? user.team.teamName || `${user.team.captainName}'s Team` : null
  const mySeatedTeam = user?.team && !user.isCaptain

  const navTabs = [
    { id: 'home', label: 'Home' },
    ...(user?.enrolled ? [{ id: 'myteam', label: 'My Team' }] : []),
    { id: 'pairings', label: 'Pairings' },
    { id: 'standings', label: 'Standings' },
    { id: 'teams', label: 'Teams' },
    { id: 'decklists', label: 'Decklists' },
    { id: 'roster', label: 'Roster' },
    { id: 'halloffame', label: 'Hall of Fame' },
    { id: 'rules', label: 'Rules' },
    ...(user?.isAdmin ? [{ id: 'admin', label: 'Admin' }] : []),
  ]
  const page = navTabs.some((t) => t.id === activeTab) ? activeTab : 'home'

  const renderReportButtons = (p) => (
    <div className="pairing-actions">
      <button className="link-btn" disabled={reportBusyId === p.id} onClick={() => handleReportResult(p.id, 'win')}>
        We Won
      </button>
      <button className="link-btn" disabled={reportBusyId === p.id} onClick={() => handleReportResult(p.id, 'loss')}>
        We Lost
      </button>
    </div>
  )

  // A team's players, each in their format's color. Uses the seat assignments
  // when the team is full, otherwise just the captain and whoever has joined.
  const renderTeamPlayers = (team) => {
    const seated = SEATS.filter((s) => team.seats?.[s]).map((s) => team.seats[s])
    const players = seated.length
      ? seated
      : [{ id: team.captainId, displayName: team.captainName }, ...team.members]
    return players.map((p, i) => (
      <span key={p.id}>
        <span className={formatClass(p.id)}>{p.displayName}</span>
        {i < players.length - 1 ? ' · ' : ''}
      </span>
    ))
  }

  const renderStandingsTable = (rows) => (
    <table className="standings-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th>W</th>
          <th>L</th>
          <th title="Opponents' match-win percentage">OMW%</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((team, idx) => {
          const classes = [
            team.eliminated ? 'standings-eliminated' : '',
            user?.myTeamCaptainId === team.captainId ? 'standings-mine' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <tr key={team.captainId} className={classes}>
              <td className="rank-cell">{idx + 1}</td>
              <td>
                {team.eliminated && <span title="Eliminated">❌ </span>}
                <span className={team.eliminated ? 'eliminated-name' : ''}>{teamLabel(team)}</span>
                {team.eliminated && <span className="tag tag-eliminated">Eliminated</span>}
                <div className="standings-players">{renderTeamPlayers(team)}</div>
              </td>
              <td>{team.wins}</td>
              <td>{team.losses}</td>
              <td>{formatOmw(team.omw)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )

  const renderStandingsNote = () => (
    <p className="muted small standings-note">
      {openRound && `Includes results reported so far in Round ${openRound.number}, which is still in progress. `}
      Ties are broken by OMW% — the average match-win percentage of the teams you've played (each opponent counts for
      at least 33.3%, byes are ignored).
    </p>
  )

  // ---------- Home ----------

  const renderHome = () => (
    <div className="stack-col">
      <section className="panel hero">
        <img src="/logo.png" alt="Orchid League" className="hero-logo" />
        <div className="hero-text">
          <h1>Orchid League</h1>
          <p className="hero-tagline">
            {user
              ? `Welcome, ${user.displayName}!`
              : 'Three-player teams · Standard, Modern & Pioneer · Playing for charity'}
          </p>
          {!settings.signupsOpen && <p className="closed-banner">🔒 Signups are currently closed.</p>}
        </div>
        {nextRoundAtMs && (
          <div className="hero-countdown">
            <div className="hero-countdown-label">{openRound ? 'Results due & next round in' : 'Next round in'}</div>
            <div className="hero-countdown-value">{countdownMs === 0 ? 'Any moment' : countdownLabel}</div>
            <div className="countdown-sub">{nextRoundAtLabel}</div>
          </div>
        )}
      </section>

      <div className="grid-2">
        {user ? (
          <section className="panel">
            <h2>Your Status</h2>
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
            {user.enrolled && (
              <ul className="status-list">
                <li>
                  <span>Team</span>
                  <span>{myTeamName ?? 'Not on a team yet'}</span>
                </li>
                <li>
                  <span>Decklist</span>
                  <span>
                    {user.decklist?.trim() ? '✅ Submitted' : '⬜ Not submitted'}{' '}
                    <button className="link-btn" onClick={() => navigate('myteam')}>
                      {user.decklist?.trim() ? 'Edit' : 'Add one'}
                    </button>
                  </span>
                </li>
              </ul>
            )}
            {!user.enrolled && settings.signupsOpen && (
              <p className="muted">Tick the box above to join. Captains then build their team of three.</p>
            )}
          </section>
        ) : (
          <section className="panel">
            <h2>Join the League</h2>
            <p className="muted">
              Sign in with Discord to enroll, join a team and report results. You need to be a member of the Orchid
              League Discord server.
            </p>
            {loginError && <p className="inline-error">{loginError}</p>}
            <a className="discord-btn" href={`${SERVER_URL}/auth/discord`}>
              Login with Discord
            </a>
          </section>
        )}

        {user?.enrolled ? (
          <section className="panel">
            <h2>{openRound ? `Round ${openRound.number}` : 'This Round'}</h2>
            {!openRound ? (
              <p className="muted">No round is in progress right now.</p>
            ) : !myPairing ? (
              <p className="muted">Your team isn't paired this round.</p>
            ) : (
              <>
                <p className="pairing-teams">
                  {myPairing.teamA.name}
                  {myPairing.teamB ? ` vs ${myPairing.teamB.name}` : ''}
                </p>
                <p className="muted">{pairingResultLabel(myPairing)}</p>
                {myCurrentMatch && (
                  <p className="my-match-summary">
                    <span className="matchup-format">{SEAT_LABELS[myCurrentMatch.mine.seat]}:</span>{' '}
                    <span className={`format-${myCurrentMatch.mine.seat}`}>{myCurrentMatch.mine.me.displayName}</span>
                    {' vs '}
                    <span className={`format-${myCurrentMatch.mine.seat}`}>
                      {myCurrentMatch.mine.opp?.displayName ?? 'TBD'}
                    </span>
                  </p>
                )}
                {myPairing.teamB && !myPairing.result && renderReportButtons(myPairing)}
                <button className="secondary-btn small-btn" onClick={() => navigate('pairings')}>
                  View matchup &amp; decklists
                </button>
              </>
            )}
          </section>
        ) : (
          <section className="panel">
            <h2>How it works</h2>
            <ul className="how-list">
              <li>Enroll, then a captain builds a team of three: one player per format.</li>
              <li>Teams are paired weekly (Swiss). Each seat plays its matching format.</li>
              <li>Report your result before the deadline, or both teams take a loss.</li>
              <li>Three losses and a team is eliminated.</li>
            </ul>
            <button className="link-btn" onClick={() => navigate('rules')}>
              Read the full rules →
            </button>
          </section>
        )}
      </div>

      {standings.length > 0 && (
        <section className="panel">
          <h2>Standings</h2>
          {renderStandingsTable(standings)}
          {renderStandingsNote()}
        </section>
      )}
    </div>
  )

  // ---------- My Team ----------

  const renderMyDecklistPanel = () => (
    <section className="panel">
      <h2>My Decklist</h2>
      <p className="muted small">
        Paste your decklist here. Edits only apply starting next round — whatever's saved when a round is generated is
        what's shown for that round.
      </p>
      <textarea
        className="text-input textarea-input"
        value={decklistDraft}
        maxLength={5000}
        placeholder="Paste your decklist..."
        onChange={(e) => setDecklistDraft(e.target.value)}
      />
      <button className="secondary-btn save-btn" disabled={decklistSaving} onClick={handleSaveDecklist}>
        {decklistSaving ? 'Saving...' : 'Save Decklist'}
      </button>

      <h3 className="sub-heading">Submitted decklist</h3>
      {user.decklist?.trim() ? (
        <LazyDetails summary="View formatted decklist">
          {decklistDraft !== user.decklist && (
            <p className="muted small">You have unsaved changes — save to update this preview.</p>
          )}
          <div className="deck-panel">
            <DeckView text={user.decklist} cardInfo={cardInfo} ensureCards={ensureCards} />
          </div>
        </LazyDetails>
      ) : (
        <p className="muted small">Nothing submitted yet. Save a decklist above and a formatted view will appear here.</p>
      )}
    </section>
  )

  const renderCaptainPanel = () => (
    <section className="panel">
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
          <h3 className="sub-heading">Seat Assignments</h3>
          <p className="muted small">Drag a player onto another seat to swap them (or tap one, then tap another).</p>
          <p className="muted small">
            ℹ️ Swaps only affect future rounds — your team's matchups for the current round are already locked in and
            won't change.
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
          <h3 className="sub-heading">Add a Teammate</h3>
          {candidates.length === 0 ? (
            <p className="muted">No eligible players available right now.</p>
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
    </section>
  )

  const renderMemberTeamPanel = () => (
    <section className="panel">
      <h2>Your Team</h2>
      {user.team.eliminated && (
        <p className="closed-banner">❌ Your team has been eliminated (3 losses) and will not receive future pairings.</p>
      )}
      <p className="pairing-teams">{myTeamName}</p>
      {user.team.charity && <p className="muted">Playing for: {user.team.charity}</p>}
      <ul className="roster-list">
        <li className="team-slot captain-slot">
          <span className={formatClass(user.team.captainId)}>{user.team.captainName}</span> (Captain)
        </li>
        {user.team.members.map((m) => (
          <li key={m.id} className="team-slot">
            <span className={formatClass(m.id)}>{m.displayName}</span>
            {m.id === user.id && <span className="tag">You</span>}
          </li>
        ))}
      </ul>
      <h3 className="sub-heading">Seat Assignments</h3>
      <div className="seat-grid">
        {SEATS.map((seat) => (
          <div key={seat} className="seat-card seat-static">
            <div className="seat-label">{SEAT_LABELS[seat]}</div>
            <div className={`seat-occupant format-${seat}`}>{user.team.seats?.[seat]?.displayName ?? '—'}</div>
          </div>
        ))}
      </div>
      <p className="muted small">Your captain manages seats, the team name and the charity.</p>
    </section>
  )

  const renderTeammateDecklists = () => (
    <section className="panel">
      <h2>Teammates' Decklists</h2>
      <p className="muted small">
        Edit on their behalf if they're stuck or unresponsive — this overwrites whatever they've saved.
      </p>
      {teammates.map((m) => (
        <details key={m.id} className="decklist-details member-decklist-editor">
          <summary>{m.displayName}'s Decklist</summary>
          <textarea
            className="text-input textarea-input"
            value={memberDecklistDrafts[m.id] ?? ''}
            maxLength={5000}
            placeholder="Paste their decklist..."
            onChange={(e) => setMemberDecklistDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))}
          />
          <button
            className="secondary-btn save-btn"
            disabled={memberDecklistSaving === m.id}
            onClick={() => handleSaveMemberDecklist(m.id)}
          >
            {memberDecklistSaving === m.id ? 'Saving...' : 'Save'}
          </button>
        </details>
      ))}
    </section>
  )

  const renderMyTeam = () => (
    <>
      <div className="page-head">
        <h2>My Team</h2>
      </div>
      {!user.team && (
        <section className="panel">
          <h2>No team yet</h2>
          <p className="muted">
            {user.isCaptain
              ? 'Setting up your team…'
              : 'You are not on a team yet. Ask a captain to add you, or tick "I am the Team Captain" on the Home page to start your own.'}
          </p>
        </section>
      )}
      <div className="grid-2">
        <div className="stack-col">
          {renderMyDecklistPanel()}
          {user.team && teammates.length > 0 && renderTeammateDecklists()}
        </div>
        <div className="stack-col">
          {user.isCaptain && user.team && renderCaptainPanel()}
          {mySeatedTeam && renderMemberTeamPanel()}
        </div>
      </div>
    </>
  )

  // ---------- Pairings ----------

  const renderPairings = () => (
    <>
      <div className="page-head">
        <h2>Pairings</h2>
        {pairings.length > 0 && (
          <div className="pill-row">
            {pairings.map((r) => (
              <button
                key={r.number}
                className={`pill ${shownRound?.number === r.number ? 'active' : ''}`}
                onClick={() => setSelectedRound(r.number)}
              >
                Round {r.number}
                {r.status === 'open' && ' · Current'}
              </button>
            ))}
          </div>
        )}
      </div>

      {myCurrentMatch && shownRound?.status === 'open' && (
        <div className="my-match-card">
          <h3 className="round-heading">Your Matchup — Round {myCurrentMatch.round.number}</h3>
          <p className="my-match-summary">
            <span className="matchup-format">{SEAT_LABELS[myCurrentMatch.mine.seat]}:</span>{' '}
            <span className={`format-${myCurrentMatch.mine.seat}`}>{myCurrentMatch.mine.me.displayName}</span>
            {' vs '}
            <span className={`format-${myCurrentMatch.mine.seat}`}>{myCurrentMatch.mine.opp?.displayName ?? 'TBD'}</span>
            <span className="muted"> ({myCurrentMatch.mine.oppTeam})</span>
          </p>
          {renderMyDecks(myCurrentMatch.pairing.id, myCurrentMatch.mine)}
        </div>
      )}

      {!shownRound ? (
        <section className="panel">
          <p className="muted">No rounds have been played yet.</p>
        </section>
      ) : (
        <ul className="roster-list card-grid">
          {[...shownRound.pairings]
            .sort((a, b) => Number(isMyPairing(b)) - Number(isMyPairing(a)))
            .map((p) => {
              const mine = isMyPairing(p)
              const canReport = mine && shownRound.status === 'open' && p.teamB && !p.result
              const myMatchup = shownRound.status === 'open' ? null : findMyMatchup(p)
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
                  <div className="muted pairing-status">{pairingResultLabel(p)}</div>
                  {myMatchup && (
                    <LazyDetails
                      summary={`View your deck and ${myMatchup.opp?.displayName ?? 'your opponent'}'s deck`}
                    >
                      {renderMyDecks(p.id, myMatchup)}
                    </LazyDetails>
                  )}
                  {canReport && renderReportButtons(p)}
                </li>
              )
            })}
        </ul>
      )}
    </>
  )

  // ---------- Standings ----------

  const renderStandings = () => (
    <>
      <div className="page-head">
        <h2>Standings</h2>
      </div>
      {standings.length === 0 ? (
        <section className="panel">
          <p className="muted">No teams have been formed yet.</p>
        </section>
      ) : (
        <section className="panel">
          {renderStandingsTable(standings)}
          {renderStandingsNote()}
        </section>
      )}
    </>
  )

  // ---------- Teams ----------

  const renderTeams = () => (
    <>
      <div className="page-head">
        <h2>Teams</h2>
        <span className="muted">{teams.length} teams</span>
      </div>
      {teams.length === 0 ? (
        <section className="panel">
          <p className="muted">No teams have been formed yet.</p>
        </section>
      ) : (
        <ul className="roster-list card-grid">
          {teams.map((team) => (
            <li
              key={team.captainId}
              className={`team-row ${user?.myTeamCaptainId === team.captainId ? 'team-mine' : ''}`}
            >
              <strong>
                {teamLabel(team)}
                {team.eliminated && <span className="tag tag-eliminated">Eliminated</span>}
                {user?.isAdmin && (
                  <button
                    className="link-btn paid-toggle"
                    disabled={paidBusyId === team.captainId}
                    title={team.paid ? 'Paid — click to unmark' : 'Not paid — click to mark as paid'}
                    onClick={() => handleTogglePaid(team.captainId, team.paid)}
                  >
                    {team.paid ? '💰' : '⬜'}
                  </button>
                )}
              </strong>
              <span className="muted small">
                Record {team.wins}–{team.losses}
              </span>
              <span className="muted">
                Captain: <span className={formatClass(team.captainId)}>{team.captainName}</span>
              </span>
              <span className="muted">
                {team.members.length === 0
                  ? 'no teammates yet'
                  : team.members.map((m, idx) => (
                      <span key={m.id}>
                        <span className={formatClass(m.id)}>{m.displayName}</span>
                        {idx < team.members.length - 1 ? ', ' : ''}
                      </span>
                    ))}
              </span>
              {team.charity && <span className="muted">Playing for: {team.charity}</span>}
              {(team.seats?.pioneer || team.seats?.modern || team.seats?.standard) && (
                <span className="muted">
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
  )

  // ---------- Decklists ----------

  const decklistQuery = decklistFilter.trim().toLowerCase()
  const decklistEntries = (decklistsData.formats[decklistFormat] ?? []).filter(
    (entry) =>
      !decklistQuery ||
      [entry.playerName, entry.teamName, entry.opponentName].some((v) => (v ?? '').toLowerCase().includes(decklistQuery))
  )

  const renderDecklists = () => (
    <>
      <div className="page-head">
        <h2>Decklists</h2>
        {decklistsData.round !== null && (
          <div className="pill-row">
            {['standard', 'modern', 'pioneer'].map((seat) => (
              <button
                key={seat}
                className={`pill pill-${seat} ${decklistFormat === seat ? 'active' : ''}`}
                onClick={() => setDecklistFormat(seat)}
              >
                {SEAT_LABELS[seat]} ({decklistsData.formats[seat].length})
              </button>
            ))}
          </div>
        )}
      </div>
      {decklistsData.round === null ? (
        <section className="panel">
          <p className="muted">No round is currently in progress.</p>
        </section>
      ) : (
        <section className="panel">
          <div className="filter-row">
            <span className="muted small">Decklists locked in for Round {decklistsData.round}.</span>
            <input
              className="text-input filter-input"
              type="search"
              placeholder="Search player or team…"
              value={decklistFilter}
              onChange={(e) => setDecklistFilter(e.target.value)}
            />
          </div>
          {decklistEntries.length === 0 ? (
            <p className="muted">{decklistQuery ? 'No matches.' : 'No one seated here this round.'}</p>
          ) : (
            <ul className="roster-list card-grid decklist-grid">
              {decklistEntries.map((entry) => (
                <li key={entry.playerId} className="decklist-entry">
                  <div className="decklist-entry-header">
                    <span className={`format-${decklistFormat}`}>{entry.playerName}</span>
                    <span className="muted">
                      {' '}
                      ({entry.teamName}){entry.opponentName ? ` vs ${entry.opponentName}` : ' — Bye'}
                    </span>
                  </div>
                  {entry.decklist ? (
                    <LazyDetails
                      summary={
                        <>
                          View Decklist
                          <button
                            className="link-btn copy-btn"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleCopyDecklist(entry.decklist, entry.playerId)
                            }}
                          >
                            {copiedId === entry.playerId ? 'Copied!' : 'Copy'}
                          </button>
                        </>
                      }
                    >
                      <DeckView text={entry.decklist} cardInfo={cardInfo} ensureCards={ensureCards} />
                    </LazyDetails>
                  ) : (
                    <span className="muted">No decklist submitted.</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )

  // ---------- Roster ----------

  const renderRoster = () => (
    <>
      <div className="page-head">
        <h2>League Roster</h2>
        <span className="muted">{league.length} enrolled</span>
      </div>
      {league.length === 0 ? (
        <section className="panel">
          <p className="muted">No one has enrolled yet.</p>
        </section>
      ) : (
        <ul className="roster-list card-grid roster-grid">
          {league.map((member) => (
            <li key={member.id}>
              {member.isAdmin && <span title="Admin">👑 </span>}
              {member.isCaptain && <span title="Captain">🧑‍✈️ </span>}
              <span className={formatClass(member.id)}>{member.displayName}</span>
              {member.isCaptain && <span className="tag">Captain</span>}
              {!member.isCaptain && member.onTeam && <span className="tag">On a team</span>}
              {user?.isAdmin &&
                (member.hasDecklist ? (
                  <span title="Decklist submitted" className="decklist-status decklist-status-yes">
                    ✅
                  </span>
                ) : (
                  <span title="No decklist yet" className="decklist-status decklist-status-no">
                    ⬜
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}
    </>
  )

  // ---------- Hall of Fame ----------

  const renderHallOfFame = () => (
    <>
      <div className="page-head">
        <h2>Hall of Fame</h2>
      </div>
      <div className="hof-grid">
        {HALL_OF_FAME.map((entry) => (
          <section key={entry.season} className="panel hof-card">
            <div className="hof-trophy" aria-hidden="true">
              🏆
            </div>
            <div className="hof-season">Season {entry.season}</div>
            <div className="hof-name">{entry.champion}</div>
            {entry.handle && <div className="hof-handle">{entry.handle}</div>}
            {entry.members && (
              <ul className="hof-members">
                {entry.members.map((member) => (
                  <li key={member}>{member}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </>
  )

  // ---------- Rules ----------

  const renderRules = () => (
    <>
      <div className="page-head">
        <h2>Rules</h2>
      </div>
      <ul className="rules-list">
        <li>
          <strong>Entry Fee:</strong> Each team captain must Venmo{' '}
          <a className="rules-link" href="https://venmo.com/neil-estrada-2" target="_blank" rel="noreferrer">
            @neil-estrada-2
          </a>{' '}
          $30 for the entry fee. All entry fees will be donated to the charity of the winning team's choice.
        </li>
        <li>
          <strong>Elimination:</strong> Teams play until they accumulate 3 losses, at which point they are eliminated.
        </li>
        <li>
          <strong>Top Cut:</strong> There will be a top cut to the top N teams (likely 4 or 2) depending on team count.
        </li>
        <li>
          <strong>Platforms:</strong> The <span className="format-standard">Standard</span> and{' '}
          <span className="format-pioneer">Pioneer</span> seats must play all matches on Magic Arena. The{' '}
          <span className="format-modern">Modern</span> seat must play all matches on MTGO.
        </li>
        <li>
          <strong>No Draws:</strong> No draws, intentional or otherwise. If you fail to submit your result for the week,
          both teams receive a loss.
        </li>
        <li>
          <strong>Match Settings:</strong> Use the tournament settings on Magic Arena, and a 25-minute timer on Magic
          Online. Both sides can agree to play without a timer, only if they want to.
        </li>
      </ul>
    </>
  )

  // ---------- Admin ----------

  const renderAdmin = () => (
    <>
      <div className="page-head">
        <h2>Admin</h2>
      </div>
      <div className="stat-row">
        <div className="stat">
          <div className="stat-value">{league.length}</div>
          <div className="stat-label">Players enrolled</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {teams.filter((t) => t.members.length === 2).length}/{teams.length}
          </div>
          <div className="stat-label">Teams full</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {teams.filter((t) => t.paid).length}/{teams.length}
          </div>
          <div className="stat-label">Teams paid</div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {league.filter((m) => m.hasDecklist).length}/{league.length}
          </div>
          <div className="stat-label">Decklists in</div>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel">
          <h2>Round control</h2>
          <div className="admin-actions">
            <button className="secondary-btn" disabled={settingsBusy} onClick={handleToggleSignups}>
              {settings.signupsOpen ? 'Close Signups' : 'Open Signups'}
            </button>
            <button className="secondary-btn" disabled={roundBusy} onClick={handleAdvanceRound}>
              {advanceRoundLabel}
            </button>
          </div>
          <p className="muted small">
            Rounds also advance automatically at the scheduled time. Closing signups removes enrolled players who
            aren't on a team.
          </p>
        </section>

        <section className="panel">
          <h2>Discord reminders</h2>
          <div className="admin-actions">
            <button
              className="secondary-btn"
              disabled={reminderSending || !settings.discordBotConfigured}
              onClick={handleSendDecklistReminder}
            >
              Send Decklist Reminder
            </button>
            <button
              className="secondary-btn"
              disabled={resultReminderSending || !settings.discordBotConfigured}
              onClick={handleSendResultReminder}
            >
              Send Result Reminder
            </button>
          </div>
          <p className="muted small">
            {settings.autoRemindersActive
              ? 'Automatic result reminders go out 48, 24, 12, 6 and 3 hours before the deadline.'
              : 'Automatic result reminders are off in this environment.'}
          </p>
        </section>

        <section className="panel">
          <h2>Testing</h2>
          <div className="admin-actions">
            <button className="secondary-btn" disabled={dummyBusy} onClick={handleToggleDummyAccounts}>
              {settings.dummyAccountsEnabled ? 'Remove Test Accounts' : 'Add Test Accounts'}
            </button>
          </div>
        </section>

        <section className="panel danger-zone">
          <h2>Danger zone</h2>
          <div className="admin-actions">
            <button className="secondary-btn danger-btn" disabled={resetBusy} onClick={handleResetSeason}>
              Reset All Standings
            </button>
          </div>
          <p className="muted small">Clears every round, pairing and win/loss record. This can't be undone.</p>
        </section>
      </div>
    </>
  )

  const pages = {
    home: renderHome,
    myteam: renderMyTeam,
    pairings: renderPairings,
    standings: renderStandings,
    teams: renderTeams,
    decklists: renderDecklists,
    roster: renderRoster,
    halloffame: renderHallOfFame,
    rules: renderRules,
    admin: renderAdmin,
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="#home" onClick={() => setActiveTab('home')}>
            <img src="/logo.png" alt="" />
            <span>Orchid League</span>
          </a>
          <div className="topbar-spacer" />
          {nextRoundAtMs && (
            <span className="topbar-countdown" title={nextRoundAtLabel}>
              ⏳ {countdownMs === 0 ? 'Any moment' : countdownLabel}
            </span>
          )}
          {!loading &&
            (user ? (
              <div className="topbar-user">
                <span className="topbar-name">{user.displayName}</span>
                <button className="secondary-btn small-btn" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            ) : (
              <a className="discord-btn small" href={`${SERVER_URL}/auth/discord`}>
                Login with Discord
              </a>
            ))}
        </div>
        <nav className="nav" aria-label="Sections">
          {navTabs.map((t) => (
            <button
              key={t.id}
              className={`nav-btn ${page === t.id ? 'active' : ''}`}
              onClick={() => navigate(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="page">
        {error && (
          <div className="toast-error" role="alert">
            <span>{error}</span>
            <button className="toast-close" aria-label="Dismiss" onClick={() => setError('')}>
              ×
            </button>
          </div>
        )}
        {loading ? <p className="muted">Loading...</p> : pages[page]()}
      </main>
    </div>
  )
}

export default App
