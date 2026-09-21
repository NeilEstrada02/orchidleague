// Parses pasted decklist text (Arena export, MTGO export, or plain "4 Card Name"
// lines) into main / sideboard / companion sections, and groups cards by type.

const SECTION_HEADERS = {
  deck: 'main',
  main: 'main',
  maindeck: 'main',
  'main deck': 'main',
  mainboard: 'main',
  'main board': 'main',
  sideboard: 'sideboard',
  'side board': 'sideboard',
  side: 'sideboard',
  sb: 'sideboard',
  companion: 'companion',
  commander: 'commander',
}

// A blank line only starts the sideboard when the main deck is already
// roughly full-sized, so decks grouped by type with blank lines between the
// groups aren't split in the wrong place.
const MIN_MAIN_BEFORE_BLANK_SIDEBOARD = 40

const CARD_LINE = /^(?:(SB):\s*)?(\d+)\s*[xX]?\s+(.+)$/

export const cardKey = (name) => name.trim().toLowerCase()

function headerOf(line) {
  return line
    .toLowerCase()
    .replace(/^[#*=/\-\s]+/, '')
    .replace(/[:*=\-\s]+$/, '')
    .replace(/\s*\(\d+\)$/, '')
    .trim()
}

function cleanName(raw) {
  return raw
    .replace(/\s*\*[A-Za-z]+\*\s*$/, '')
    .replace(/\s+\[[A-Za-z0-9]{2,8}\](\s+\S+)?\s*$/, '')
    .replace(/\s+\([A-Za-z0-9]{2,8}\)(\s+[\w★†-]+)?\s*$/, '')
    .replace(/\s*\/{1,2}\s*/g, ' // ')
    .trim()
}

export function parseDecklist(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const hasSideboardHeader = lines.some((l) => SECTION_HEADERS[headerOf(l.trim())] === 'sideboard')

  const sections = { main: [], sideboard: [], companion: [], commander: [] }
  const unparsed = []
  let section = 'main'
  let sawBlank = false
  let mainCount = 0

  const add = (target, count, name) => {
    const list = sections[target]
    const existing = list.find((c) => cardKey(c.name) === cardKey(name))
    if (existing) existing.count += count
    else list.push({ count, name })
    if (target === 'main') mainCount += count
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      sawBlank = true
      continue
    }

    const header = headerOf(line)
    if (Object.hasOwn(SECTION_HEADERS, header)) {
      section = SECTION_HEADERS[header]
      sawBlank = false
      continue
    }
    if (header === 'about' || (/^name\b/i.test(line) && !/^\d/.test(line))) continue
    if (/^\d+\s+cards?$/i.test(line)) continue

    const match = CARD_LINE.exec(line)
    if (!match) {
      unparsed.push(line)
      continue
    }

    const count = Number(match[2])
    const name = cleanName(match[3])
    if (!name || count <= 0) continue

    let target = section
    if (match[1]) {
      target = 'sideboard'
    } else if (sawBlank && section === 'main' && !hasSideboardHeader && mainCount >= MIN_MAIN_BEFORE_BLANK_SIDEBOARD) {
      section = 'sideboard'
      target = 'sideboard'
    }
    sawBlank = false
    add(target, count, name)
  }

  const total = (list) => list.reduce((sum, c) => sum + c.count, 0)
  return {
    ...sections,
    unparsed,
    totals: {
      main: total(sections.main),
      sideboard: total(sections.sideboard),
      companion: total(sections.companion),
      commander: total(sections.commander),
    },
    hasCards: Object.values(sections).some((list) => list.length > 0),
  }
}

// Group order matches how MTGGoldfish lists a deck.
export const TYPE_GROUPS = [
  ['creature', 'Creatures'],
  ['planeswalker', 'Planeswalkers'],
  ['battle', 'Battles'],
  ['instant', 'Instants'],
  ['sorcery', 'Sorceries'],
  ['artifact', 'Artifacts'],
  ['enchantment', 'Enchantments'],
  ['land', 'Lands'],
  ['other', 'Other'],
]

// A card with several types goes in the first bucket it matches here, e.g. a
// creature-land counts as a land and an artifact creature as a creature.
const CATEGORY_PRIORITY = ['land', 'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment']

export function cardCategory(typeLine) {
  const lower = (typeLine ?? '').toLowerCase()
  return CATEGORY_PRIORITY.find((type) => new RegExp(`\\b${type}\\b`).test(lower)) ?? 'other'
}

// entries: [{ count, name }]; cardInfo: { [cardKey]: info | null | undefined }.
// Returns ordered groups of cards, each sorted by mana value then name.
export function groupByType(entries, cardInfo) {
  const buckets = new Map(TYPE_GROUPS.map(([key]) => [key, []]))
  for (const entry of entries) {
    const info = cardInfo[cardKey(entry.name)]
    buckets.get(info ? cardCategory(info.typeLine) : 'other').push({ ...entry, info: info ?? null })
  }
  return TYPE_GROUPS.map(([key, label]) => {
    const cards = buckets.get(key).sort((a, b) => {
      const cmcDiff = (a.info?.cmc ?? 0) - (b.info?.cmc ?? 0)
      return cmcDiff !== 0 ? cmcDiff : a.name.localeCompare(b.name)
    })
    return { key, label, cards, total: cards.reduce((sum, c) => sum + c.count, 0) }
  }).filter((group) => group.cards.length > 0)
}
