import { useEffect, useState } from 'react'
import { LazyDetails } from './DeckView.jsx'
import { SERVER_URL, adminRequest } from './api.js'

const SEATS = ['pioneer', 'modern', 'standard']
const SEAT_LABELS = { pioneer: 'Pioneer', modern: 'Modern', standard: 'Standard' }
const pad = (n) => String(n).padStart(2, '0')
const fmtTime = (iso) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Runs an admin action with a busy flag, refreshing site data afterwards and
// reporting the outcome through notify.
function useRunner(notify, refresh) {
  const [busy, setBusy] = useState(null)
  const run = async (key, action, okMessage) => {
    setBusy(key)
    try {
      await action()
      await refresh()
      if (okMessage) notify.ok(okMessage)
      return true
    } catch (err) {
      notify.error(err.message)
      return false
    } finally {
      setBusy(null)
    }
  }
  return [busy, run]
}

// ---------- Round editor ----------

function SeatSwap({ label, lineup, busy, onSwap }) {
  const [a, setA] = useState('pioneer')
  const [b, setB] = useState('standard')
  return (
    <div className="editor-row">
      <div className="editor-row-title">{label}</div>
      <div className="muted small editor-lineup">
        {lineup.map(({ seat, player }, i) => (
          <span key={seat}>
            {SEAT_LABELS[seat]}: <span className={`format-${seat}`}>{player?.displayName ?? '—'}</span>
            {i < lineup.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>
      <div className="editor-controls">
        <select className="text-input" value={a} onChange={(e) => setA(e.target.value)}>
          {SEATS.map((s) => (
            <option key={s} value={s}>
              {SEAT_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="muted small">↔</span>
        <select className="text-input" value={b} onChange={(e) => setB(e.target.value)}>
          {SEATS.map((s) => (
            <option key={s} value={s}>
              {SEAT_LABELS[s]}
            </option>
          ))}
        </select>
        <button className="secondary-btn small-btn" disabled={busy || a === b} onClick={() => onSwap(a, b)}>
          Swap
        </button>
      </div>
    </div>
  )
}

function DeckEditor({ pairing, decks, busy, onSave }) {
  const players = pairing.matchups
    .flatMap((m) => [
      m.playerA && { ...m.playerA, team: pairing.teamA.name },
      m.playerB && { ...m.playerB, team: pairing.teamB.name },
    ])
    .filter(Boolean)
  const [playerId, setPlayerId] = useState(players[0]?.id ?? '')
  const [text, setText] = useState('')
  useEffect(() => setText(decks[playerId] ?? ''), [playerId, decks])
  const player = players.find((p) => p.id === playerId)

  return (
    <div className="editor-row">
      <div className="editor-row-title">Locked-in decklist</div>
      <div className="editor-controls">
        <select className="text-input" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName} ({p.team})
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="text-input textarea-input"
        value={text}
        maxLength={5000}
        onChange={(e) => setText(e.target.value)}
        placeholder="Decklist for this round…"
      />
      <button
        className="secondary-btn small-btn"
        disabled={busy || !player || text === (decks[playerId] ?? '')}
        onClick={() => onSave(player, text)}
      >
        Replace decklist
      </button>
    </div>
  )
}

function PairingEditor({ round, pairing, decks, busy, run, reloadDecks }) {
  const open = round.status === 'open'
  const [result, setResult] = useState(pairing.result ?? '')
  useEffect(() => setResult(pairing.result ?? ''), [pairing.result])
  const locked = round.stage === 'playoff' && !open
  const options = open
    ? [['', 'Pending (no result)'], ['A', `${pairing.teamA.name} won`], ['B', `${pairing.teamB?.name} won`]]
    : [['A', `${pairing.teamA.name} won`], ['B', `${pairing.teamB?.name} won`], ['double-loss', 'Both teams lost (nothing reported)']]

  const status = !pairing.teamB
    ? 'Bye'
    : pairing.result === 'A'
      ? `${pairing.teamA.name} won`
      : pairing.result === 'B'
        ? `${pairing.teamB.name} won`
        : pairing.result === 'double-loss'
          ? 'Both lost'
          : 'Pending'

  const base = { roundNumber: round.number, pairingId: pairing.id }
  const lineup = (side) => pairing.matchups.map((m) => ({ seat: m.seat, player: side === 'A' ? m.playerA : m.playerB }))

  const saveResult = () => {
    const label = options.find(([value]) => value === result)?.[1]
    if (!window.confirm(`Set this match to "${label}"?${open ? '' : ' Team records will be recalculated.'}`)) return
    run(`result-${pairing.id}`, () => adminRequest('POST', '/api/admin/rounds/result', { ...base, result: result === '' ? null : result }), 'Result updated.')
  }
  const swap = (side, seatA, seatB) => {
    const team = side === 'A' ? pairing.teamA.name : pairing.teamB.name
    if (!window.confirm(`Swap ${team}'s ${SEAT_LABELS[seatA]} and ${SEAT_LABELS[seatB]} players for this round only?`)) return
    run(`swap-${pairing.id}-${side}`, () => adminRequest('POST', '/api/admin/rounds/swap-seats', { ...base, side, seatA, seatB }), 'Seats swapped for this round.')
  }
  const saveDeck = (player, text) => {
    if (!window.confirm(`Replace ${player.displayName}'s decklist for Round ${round.number}? Everyone will see the new list for this round.`)) return
    run(
      `deck-${pairing.id}`,
      async () => {
        await adminRequest('POST', '/api/admin/rounds/decklist', { ...base, playerId: player.id, text })
        await reloadDecks()
      },
      'Decklist replaced.'
    )
  }

  return (
    <li className="editor-pairing">
      <LazyDetails
        className="decklist-details"
        summary={
          <>
            {pairing.teamA.name}
            {pairing.teamB ? ` vs ${pairing.teamB.name}` : ' (bye)'} <span className="muted small">— {status}</span>
          </>
        }
      >
        {!pairing.teamB ? (
          <p className="muted small">A bye has no match to edit.</p>
        ) : (
          <div className="editor-body">
            <div className="editor-row">
              <div className="editor-row-title">Result</div>
              {locked ? (
                <p className="muted small">This playoff round is finished — results are locked because the next round was built from them.</p>
              ) : (
                <div className="editor-controls">
                  <select className="text-input" value={result} onChange={(e) => setResult(e.target.value)}>
                    {options.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button className="secondary-btn small-btn" disabled={busy || result === (pairing.result ?? '')} onClick={saveResult}>
                    Save result
                  </button>
                </div>
              )}
            </div>
            <SeatSwap label={`${pairing.teamA.name} lineup`} lineup={lineup('A')} busy={busy} onSwap={(a, b) => swap('A', a, b)} />
            <SeatSwap label={`${pairing.teamB.name} lineup`} lineup={lineup('B')} busy={busy} onSwap={(a, b) => swap('B', a, b)} />
            <DeckEditor pairing={pairing} decks={decks} busy={busy} onSave={saveDeck} />
          </div>
        )}
      </LazyDetails>
    </li>
  )
}

export function RoundEditor({ pairings, notify, refresh }) {
  const [roundNumber, setRoundNumber] = useState(null)
  const [decks, setDecks] = useState({})
  const [busy, run] = useRunner(notify, refresh)
  const round = pairings.find((r) => r.number === roundNumber) ?? pairings[0]

  const reloadDecks = async () => {
    if (!round) return
    const res = await fetch(`${SERVER_URL}/api/decklists?round=${round.number}`, { credentials: 'include' })
    const data = await res.json()
    const map = {}
    for (const list of Object.values(data.formats)) for (const entry of list) map[entry.playerId] = entry.decklist
    setDecks(map)
  }
  useEffect(() => {
    reloadDecks().catch(() => {})
  }, [round?.number])

  if (!round) {
    return (
      <section className="panel">
        <p className="muted">No rounds have been generated yet.</p>
      </section>
    )
  }

  const canUndo = round.number === pairings[0].number && round.status === 'open'
  const undo = () => {
    const name = round.label ? `Round ${round.number} (${round.label})` : `Round ${round.number}`
    if (
      !window.confirm(
        `Remove ${name} entirely? Its pairings disappear and can't be brought back except from a backup. If it was already due to start on schedule, a fresh round is generated again right away.`
      )
    )
      return
    run('undo', () => adminRequest('POST', '/api/admin/rounds/undo', {}), `${name} removed.`)
  }

  return (
    <div className="stack-col">
      <section className="panel">
        <h2>Fix a round</h2>
        <p className="muted small">
          Correct a mistake in a round that's already been generated: change a match result, swap two players' formats,
          or replace a locked-in decklist. Every change is recorded in the audit log, and a backup is taken first.
        </p>
        <div className="pill-row">
          {pairings.map((r) => (
            <button
              key={r.number}
              className={`pill ${round.number === r.number ? 'active' : ''}`}
              onClick={() => setRoundNumber(r.number)}
            >
              Round {r.number}
              {r.label ? ` · ${r.label}` : ''}
              {r.status === 'open' ? ' · Current' : ''}
            </button>
          ))}
        </div>
        {canUndo && (
          <div className="editor-undo">
            <button className="secondary-btn danger-btn small-btn" disabled={busy === 'undo'} onClick={undo}>
              Undo this round
            </button>
            <span className="muted small">Removes the round entirely — for one started by mistake.</span>
          </div>
        )}
      </section>
      <ul className="roster-list">
        {round.pairings.map((pairing) => (
          <PairingEditor
            key={pairing.id}
            round={round}
            pairing={pairing}
            decks={decks}
            busy={Boolean(busy)}
            run={run}
            reloadDecks={reloadDecks}
          />
        ))}
      </ul>
    </div>
  )
}

// ---------- Season ----------

function formatFirstRound(fr) {
  const date = new Date(Date.UTC(fr.year, fr.month - 1, fr.day)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const hour = fr.hour % 12 || 12
  return `${date} at ${hour}:${pad(fr.minute)} ${fr.hour >= 12 ? 'PM' : 'AM'} Eastern`
}

export function SeasonPanel({ settings, bracket, teams, hallOfFame, notify, refresh }) {
  const [busy, run] = useRunner(notify, refresh)
  const fr = settings.firstRound
  const [seasonDraft, setSeasonDraft] = useState(String(settings.seasonNumber ?? 4))
  const [dateDraft, setDateDraft] = useState(fr ? `${fr.year}-${pad(fr.month)}-${pad(fr.day)}` : '')
  const [timeDraft, setTimeDraft] = useState(fr ? `${pad(fr.hour)}:${pad(fr.minute)}` : '23:59')
  const [cutSize, setCutSize] = useState('4')
  const [champion, setChampion] = useState(null)
  const [hof, setHof] = useState({ season: '', champion: '', handle: '', members: '' })

  useEffect(() => setSeasonDraft(String(settings.seasonNumber ?? 4)), [settings.seasonNumber])

  const ranked = [...teams].sort(
    (a, b) => b.wins - a.wins || a.losses - b.losses || (b.omw ?? -1) - (a.omw ?? -1) || a.captainName.localeCompare(b.captainName)
  )
  const label = (t) => t.teamName || `${t.captainName}'s Team`
  const defaultChampion = bracket?.champion ? 'bracket' : ranked[0]?.captainId ?? ''
  const championValue = champion ?? defaultChampion
  const championName =
    championValue === 'bracket'
      ? bracket?.champion?.name
      : ranked.find((t) => t.captainId === championValue)
        ? label(ranked.find((t) => t.captainId === championValue))
        : null

  const saveSeasonNumber = () =>
    run('season-number', () => adminRequest('POST', '/api/admin/season/number', { number: Number(seasonDraft) }), 'Season number saved.')

  const saveSchedule = async (confirmPast = false) => {
    const [year, month, day] = dateDraft.split('-').map(Number)
    const [hour, minute] = timeDraft.split(':').map(Number)
    if (!dateDraft || !timeDraft) return notify.error('Pick a date and time for Round 1.')
    const body = { firstRound: { year, month, day, hour, minute }, confirmPast }
    try {
      await adminRequest('POST', '/api/admin/season/schedule', body)
      await refresh()
      notify.ok('Schedule saved. Rounds now start automatically every week.')
    } catch (err) {
      if (err.message === 'schedule_in_past') {
        if (
          window.confirm(
            'That start time has already passed, so the next round would begin immediately (and any round already past due would be closed with losses for everyone who has not reported). Continue anyway?'
          )
        )
          return saveSchedule(true)
      } else {
        notify.error(err.message)
      }
    }
  }

  const clearSchedule = () => {
    if (!window.confirm('Clear the round schedule? Rounds will only start when you start them by hand.')) return
    run('clear-schedule', () => adminRequest('POST', '/api/admin/season/schedule', { clear: true }), 'Schedule cleared.')
  }

  const cut = (action) => {
    const size = Number(cutSize)
    if (action === 'start' && !window.confirm(`Close the current round now and start a top ${size} cut? The top ${size} teams by standings are seeded into a single-elimination bracket.`)) return
    run(
      `cut-${action}`,
      () => adminRequest('POST', '/api/admin/cut', { action, size }),
      action === 'start' ? 'Top cut started.' : action === 'schedule' ? `Top ${size} cut scheduled for the next round start.` : 'Scheduled cut cancelled.'
    )
  }

  const endSeason = () => {
    const season = settings.seasonNumber
    const who = championValue ? championName ?? 'the champion' : null
    const message = who
      ? `End Season ${season}? This archives the whole season, adds ${who} to the Hall of Fame, then resets standings, the bracket and the round schedule for Season ${season + 1}. A backup is saved first.`
      : `End Season ${season} with no champion? This archives the season, then resets standings, the bracket and the round schedule for Season ${season + 1}. A backup is saved first.`
    if (!window.confirm(message)) return
    run(
      'end-season',
      () => adminRequest('POST', '/api/admin/season/end', { champion: championValue || null }),
      `Season ${season} archived. Season ${season + 1} is ready — set its schedule above.`
    )
  }

  const saveHof = () => {
    const season = Number(hof.season)
    run(
      'hof-save',
      () =>
        adminRequest('POST', '/api/admin/hall-of-fame', {
          season,
          champion: hof.champion,
          handle: hof.handle,
          members: hof.members.split(',').map((m) => m.trim()).filter(Boolean),
        }),
      'Hall of Fame saved.'
    ).then((ok) => ok && setHof({ season: '', champion: '', handle: '', members: '' }))
  }
  const removeHof = (entry) => {
    if (!window.confirm(`Remove Season ${entry.season} (${entry.champion}) from the Hall of Fame?`)) return
    run(`hof-${entry.season}`, () => adminRequest('DELETE', `/api/admin/hall-of-fame/${entry.season}`), 'Removed from the Hall of Fame.')
  }

  const cutStatus = bracket?.active
    ? bracket.champion
      ? `Top ${bracket.size} cut finished — ${bracket.champion.name} won.`
      : `Top ${bracket.size} cut in progress.`
    : settings.plannedCutSize
      ? `A top ${settings.plannedCutSize} cut is scheduled to begin at the next round start.`
      : 'No top cut yet — the league is still playing Swiss rounds.'

  return (
    <div className="grid-2">
      <section className="panel">
        <h2>Season &amp; schedule</h2>
        <div className="field-group">
          <label className="field-label" htmlFor="seasonNumber">
            Season number
          </label>
          <div className="editor-controls">
            <input
              id="seasonNumber"
              className="text-input"
              type="number"
              min="1"
              max="99"
              value={seasonDraft}
              onChange={(e) => setSeasonDraft(e.target.value)}
            />
            <button
              className="secondary-btn small-btn"
              disabled={busy === 'season-number' || Number(seasonDraft) === settings.seasonNumber}
              onClick={saveSeasonNumber}
            >
              Save
            </button>
          </div>
        </div>
        <p className="muted small">
          {fr ? `Round 1 starts ${formatFirstRound(fr)}. Later rounds follow every week.` : 'No schedule — rounds only start when you start them by hand.'}
        </p>
        <div className="field-group">
          <span className="field-label">Round 1 starts (Eastern time)</span>
          <div className="editor-controls">
            <input className="text-input" type="date" value={dateDraft} onChange={(e) => setDateDraft(e.target.value)} />
            <input className="text-input" type="time" value={timeDraft} onChange={(e) => setTimeDraft(e.target.value)} />
          </div>
        </div>
        <div className="admin-actions">
          <button className="secondary-btn" disabled={busy !== null} onClick={() => saveSchedule(false)}>
            Save schedule
          </button>
          {fr && (
            <button className="secondary-btn" disabled={busy !== null} onClick={clearSchedule}>
              Clear schedule
            </button>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>Top cut</h2>
        <p className="muted small">{cutStatus}</p>
        {!bracket?.active && (
          <>
            <div className="field-group">
              <label className="field-label" htmlFor="cutSize">
                Teams in the cut
              </label>
              <select id="cutSize" className="text-input" value={cutSize} onChange={(e) => setCutSize(e.target.value)} disabled={Boolean(settings.plannedCutSize)}>
                <option value="2">Top 2 (just the Finals)</option>
                <option value="4">Top 4 (Semifinals + Finals)</option>
                <option value="8">Top 8 (Quarterfinals on)</option>
              </select>
            </div>
            <div className="admin-actions">
              {settings.plannedCutSize ? (
                <button className="secondary-btn" disabled={busy !== null} onClick={() => cut('cancel')}>
                  Cancel scheduled cut
                </button>
              ) : (
                <>
                  <button className="secondary-btn" disabled={busy !== null} onClick={() => cut('schedule')}>
                    Schedule for next round start
                  </button>
                  <button className="secondary-btn" disabled={busy !== null} onClick={() => cut('start')}>
                    Start now
                  </button>
                </>
              )}
            </div>
          </>
        )}
        <p className="muted small">
          Single elimination, seeded by the standings. A playoff match nobody reports goes to the higher seed.
        </p>
      </section>

      <section className="panel">
        <h2>End the season</h2>
        <p className="muted small">
          Archives Season {settings.seasonNumber} in full, adds its champion to the Hall of Fame, and resets standings,
          the bracket and the schedule for the next season.
        </p>
        <div className="field-group">
          <label className="field-label" htmlFor="championSelect">
            Champion
          </label>
          <select id="championSelect" className="text-input" value={championValue} onChange={(e) => setChampion(e.target.value)}>
            {bracket?.champion && <option value="bracket">{bracket.champion.name} (top cut winner)</option>}
            {ranked.map((t) => (
              <option key={t.captainId} value={t.captainId}>
                {label(t)} ({t.wins}-{t.losses})
              </option>
            ))}
            <option value="">No champion</option>
          </select>
        </div>
        <button className="secondary-btn danger-btn" disabled={busy !== null} onClick={endSeason}>
          End Season {settings.seasonNumber}
        </button>
      </section>

      <section className="panel">
        <h2>Hall of Fame entries</h2>
        <ul className="roster-list">
          {hallOfFame.map((entry) => (
            <li key={entry.season} className="team-slot">
              <span>
                <strong>Season {entry.season}</strong> — {entry.champion}
                {entry.handle ? ` (${entry.handle})` : ''}
                {entry.members ? ` · ${entry.members.join(', ')}` : ''}
              </span>
              <button className="link-btn" disabled={busy !== null} onClick={() => removeHof(entry)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <h3 className="sub-heading">Add or replace an entry</h3>
        <div className="field-group">
          <input className="text-input" type="number" min="1" placeholder="Season number" value={hof.season} onChange={(e) => setHof({ ...hof, season: e.target.value })} />
          <input className="text-input" type="text" maxLength={80} placeholder="Champion (person or team name)" value={hof.champion} onChange={(e) => setHof({ ...hof, champion: e.target.value })} />
          <input className="text-input" type="text" maxLength={60} placeholder="Discord handle (optional)" value={hof.handle} onChange={(e) => setHof({ ...hof, handle: e.target.value })} />
          <input className="text-input" type="text" placeholder="Team members, comma separated (optional)" value={hof.members} onChange={(e) => setHof({ ...hof, members: e.target.value })} />
          <button className="secondary-btn save-btn" disabled={busy !== null || !hof.season || !hof.champion.trim()} onClick={saveHof}>
            Save entry
          </button>
        </div>
      </section>
    </div>
  )
}

// ---------- Backups & audit log ----------

const REASON_LABELS = {
  nightly: 'Nightly',
  manual: 'Manual',
  'pre-advance': 'Before a round advance',
  'pre-reset': 'Before a reset',
  'pre-end-season': 'Before ending the season',
  'pre-cut': 'Before the top cut',
  'pre-correction': 'Before a correction',
  'pre-undo-round': 'Before undoing a round',
  'pre-restore': 'Before a restore',
}

const ACTION_LABELS = {
  advance_round: 'Advanced the round',
  reset_standings: 'Reset all standings',
  set_result: 'Changed a match result',
  swap_round_seats: "Swapped a round's seats",
  set_round_decklist: 'Replaced a locked-in decklist',
  undo_round: 'Removed the open round',
  schedule_cut: 'Scheduled a top cut',
  cancel_cut: 'Cancelled the scheduled cut',
  start_cut: 'Started the top cut',
  end_season: 'Ended the season',
  set_season_number: 'Set the season number',
  set_schedule: 'Set the round schedule',
  clear_schedule: 'Cleared the round schedule',
  hall_of_fame_save: 'Saved a Hall of Fame entry',
  hall_of_fame_remove: 'Removed a Hall of Fame entry',
  create_backup: 'Made a backup',
  restore_backup: 'Restored a backup',
}

export function BackupsPanel({ notify, refresh }) {
  const [backups, setBackups] = useState(null)
  const [audit, setAudit] = useState([])
  const [busy, run] = useRunner(notify, refresh)

  const load = async () => {
    const [b, a] = await Promise.all([adminRequest('GET', '/api/admin/backups'), adminRequest('GET', '/api/admin/audit')])
    setBackups(b.backups)
    setAudit(a.entries)
  }
  useEffect(() => {
    load().catch((err) => notify.error(err.message))
  }, [])

  const create = () => run('create', async () => { await adminRequest('POST', '/api/admin/backups', {}); await load() }, 'Backup saved.')
  const restore = (backup) => {
    if (
      !window.confirm(
        `Restore the backup from ${fmtTime(backup.createdAt)} (${REASON_LABELS[backup.reason] ?? backup.reason})? Rounds, teams, players' decklists, settings and the Hall of Fame go back to how they were then. Your current state is backed up first, so this can be undone.`
      )
    )
      return
    run(`restore-${backup.id}`, async () => { await adminRequest('POST', `/api/admin/backups/${backup.id}/restore`, {}); await load() }, 'Backup restored.')
  }

  return (
    <div className="stack-col">
      <section className="panel">
        <div className="panel-head">
          <h2>Backups</h2>
          <button className="secondary-btn small-btn" disabled={busy !== null} onClick={create}>
            Back up now
          </button>
        </div>
        <p className="muted small">
          A copy is saved every night, and before anything risky (advancing a round, resetting, ending a season,
          corrections). Download one to keep a copy off the site.
        </p>
        {backups === null ? (
          <p className="muted">Loading…</p>
        ) : backups.length === 0 ? (
          <p className="muted">No backups yet.</p>
        ) : (
          <ul className="roster-list">
            {backups.map((backup) => (
              <li key={backup.id} className="team-slot">
                <span>
                  {fmtTime(backup.createdAt)} — {REASON_LABELS[backup.reason] ?? backup.reason}{' '}
                  <span className="muted small">
                    ({Math.max(1, Math.round(backup.bytes / 1024))} KB{backup.note ? ` · ${backup.note}` : ''})
                  </span>
                </span>
                <span className="backup-actions">
                  <a className="link-btn" href={`${SERVER_URL}/api/admin/backups/${backup.id}/download`}>
                    Download
                  </a>
                  <button className="link-btn" disabled={busy !== null} onClick={() => restore(backup)}>
                    Restore
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Recent admin actions</h2>
        {audit.length === 0 ? (
          <p className="muted">Nothing recorded yet.</p>
        ) : (
          <ul className="roster-list">
            {audit.map((entry, i) => (
              <li key={i}>
                <div>
                  {ACTION_LABELS[entry.action] ?? entry.action}{' '}
                  <span className="muted small">
                    — {entry.actor?.name ?? 'system'}, {fmtTime(entry.at)}
                  </span>
                </div>
                {Object.keys(entry.details ?? {}).length > 0 && (
                  <div className="muted small audit-details">{JSON.stringify(entry.details)}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
