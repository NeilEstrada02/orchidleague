import { recordLogin, setEnrollment, setCaptain, deleteUsers } from './userStore.js';
import { addMember, setTeamInfo, disbandTeam, removeMemberEverywhere, getAllTeams } from './teamStore.js';

const PEOPLE = [
  { id: '900000000000000001', username: 'shadowfox_dev', displayName: 'Shadowfox' },
  { id: '900000000000000002', username: 'pixelqueen', displayName: 'PixelQueen' },
  { id: '900000000000000003', username: 'granitewolf', displayName: 'GraniteWolf' },
  { id: '900000000000000004', username: 'nova.stitch', displayName: 'NovaStitch' },
  { id: '900000000000000005', username: 'orbitalmango', displayName: 'OrbitalMango' },
  { id: '900000000000000006', username: 'frostbyte_x', displayName: 'Frostbyte' },
  { id: '900000000000000007', username: 'emberhollow', displayName: 'Emberhollow' },
  { id: '900000000000000008', username: 'voltstrike', displayName: 'Voltstrike' },
  { id: '900000000000000009', username: 'lunar.wren', displayName: 'Lunarwren' },
  { id: '900000000000000010', username: 'mossveil', displayName: 'Mossveil' },
  { id: '900000000000000011', username: 'duskrunner', displayName: 'Duskrunner' },
  { id: '900000000000000012', username: 'ironclad99', displayName: 'Ironclad' },
  { id: '900000000000000013', username: 'copperfang', displayName: 'Copperfang' },
  { id: '900000000000000014', username: 'sablewing', displayName: 'Sablewing' },
];

export const DUMMY_IDS = PEOPLE.map((p) => p.id);

const TEAMS = [
  {
    captain: '900000000000000006',
    members: ['900000000000000007', '900000000000000008'],
    teamName: 'Frost Bytes',
    charity: 'American Red Cross',
  },
  {
    captain: '900000000000000009',
    members: ['900000000000000010', '900000000000000011'],
    teamName: "Wren's Wardens",
    charity: "St. Jude Children's Hospital",
  },
  {
    captain: '900000000000000012',
    members: ['900000000000000013', '900000000000000014'],
    teamName: 'Ironclad Legion',
    charity: 'Doctors Without Borders',
  },
];

// The first 5 (Shadowfox, PixelQueen, GraniteWolf, NovaStitch, OrbitalMango)
// are left enrolled but teamless, available for a real captain to recruit
// during testing. The rest form 3 pre-built teams.
export async function seedDummyAccounts() {
  for (const p of PEOPLE) {
    await recordLogin(p);
    await setEnrollment(p.id, true);
  }
  for (const t of TEAMS) {
    await setCaptain(t.captain, true);
    for (const m of t.members) {
      await addMember(t.captain, m);
    }
    await setTeamInfo(t.captain, { teamName: t.teamName, charity: t.charity });
  }
}

export async function clearDummyAccounts() {
  const teams = await getAllTeams();
  for (const team of teams) {
    if (DUMMY_IDS.includes(team.captainId)) {
      await disbandTeam(team.captainId);
    }
  }
  for (const id of DUMMY_IDS) {
    await removeMemberEverywhere(id);
  }
  await deleteUsers(DUMMY_IDS);
}
