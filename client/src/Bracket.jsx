function Team({ team, match, myCaptainId }) {
  const decided = match.winnerId !== null
  const won = decided && match.winnerId === team.captainId
  const className = ['bracket-team', won ? 'winner' : '', decided && !won ? 'loser' : '', myCaptainId === team.captainId ? 'mine' : '']
    .filter(Boolean)
    .join(' ')
  return (
    <div className={className} title={team.members.join(', ')}>
      <span className="bracket-seed">#{team.seed}</span>
      <span className="bracket-name">{team.name}</span>
      {won && <span aria-label="Advanced">✓</span>}
    </div>
  )
}

export function Bracket({ bracket, myCaptainId }) {
  const columns = [
    ...bracket.rounds.map((r) => ({ key: r.number, label: r.label, matches: r.matches })),
    ...bracket.upcoming.map((u, i) => ({
      key: `upcoming-${i}`,
      label: u.label,
      matches: Array.from({ length: u.matchCount }, () => null),
    })),
  ]

  return (
    <>
      {bracket.champion && (
        <section className="panel champion-banner">
          <div className="hof-trophy" aria-hidden="true">
            🏆
          </div>
          <div className="hof-season">Champion</div>
          <div className="hof-name">{bracket.champion.name}</div>
          <div className="muted">{bracket.champion.members.join(' · ')}</div>
        </section>
      )}
      <div className="bracket-scroll">
        <div className="bracket-grid">
          {columns.map((col) => (
            <div key={col.key} className="bracket-col">
              <div className="bracket-col-title">{col.label}</div>
              <div className="bracket-matches">
                {col.matches.map((match, i) =>
                  match ? (
                    <div key={match.id} className="bracket-match">
                      <Team team={match.teamA} match={match} myCaptainId={myCaptainId} />
                      <Team team={match.teamB} match={match} myCaptainId={myCaptainId} />
                      <div className="bracket-status">
                        {match.winnerId ? (match.autoResolved ? 'Advanced as higher seed' : 'Final') : 'In progress'}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="bracket-match tbd">
                      To be decided
                    </div>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
