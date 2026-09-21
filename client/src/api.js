export const SERVER_URL = import.meta.env.VITE_SERVER_URL || ''

const ERROR_TEXT = {
  not_authenticated: 'You need to be signed in.',
  not_admin: 'Only admins can do that.',
  invalid_body: 'That request was not valid — check the fields and try again.',
  not_enough_teams: 'There are not enough full teams for that.',
  cut_already_started: 'A top cut has already started this season.',
  season_complete: 'The season is complete — end it from the Season tab.',
  no_bracket_champion: 'The top cut has no champion yet.',
  team_not_found: 'That team no longer exists.',
  playoff_round_closed: "That playoff round is finished, so its results can't be changed.",
  round_not_found: 'That round no longer exists.',
  pairing_not_found: 'That pairing no longer exists.',
  bye_has_no_result: 'A bye has no result to change.',
  invalid_result: "That result isn't allowed for this round.",
  invalid_seats: 'Pick two different formats to swap.',
  player_not_in_pairing: "That player isn't in this pairing.",
  round_already_closed: 'Only a round that is still open can be undone.',
  no_rounds: 'There are no rounds to undo.',
  backup_not_found: 'That backup no longer exists.',
  no_schedule: 'Set the season schedule first.',
}

// Calls an admin endpoint; throws an Error with a readable message on failure.
export async function adminRequest(method, path, body) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(ERROR_TEXT[data.error] ?? data.error ?? 'Something went wrong.')
  return data
}
