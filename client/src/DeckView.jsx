import { useEffect, useMemo, useState } from 'react'
import { cardKey, groupByType, parseDecklist } from './decklist.js'

const PREVIEW_WIDTH = 250
const PREVIEW_HEIGHT = 350

// A <details> that only mounts its content once opened, so decks that are
// never looked at never trigger card lookups.
export function LazyDetails({ className = 'decklist-details', summary, children }) {
  const [open, setOpen] = useState(false)
  return (
    <details className={className} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && children}
    </details>
  )
}

function ManaCost({ cost }) {
  return (
    <span className="mana-cost">
      {cost.split(' // ').map((half, i) => (
        <span key={i} className="mana-half">
          {i > 0 && <span className="mana-sep">//</span>}
          {[...half.matchAll(/\{([^}]+)\}/g)].map((m, j) => (
            <img
              key={j}
              className="mana-symbol"
              src={`https://svgs.scryfall.io/card-symbols/${m[1].replace(/\//g, '')}.svg`}
              alt={`{${m[1]}}`}
              loading="lazy"
            />
          ))}
        </span>
      ))}
    </span>
  )
}

export function DeckView({ text, cardInfo, ensureCards }) {
  const deck = useMemo(() => parseDecklist(text), [text])
  const [raw, setRaw] = useState(false)
  const [preview, setPreview] = useState(null)
  const canHover = useMemo(() => window.matchMedia?.('(hover: hover)').matches ?? true, [])

  const names = useMemo(
    () => [...deck.main, ...deck.sideboard, ...deck.companion, ...deck.commander].map((c) => c.name),
    [deck]
  )
  useEffect(() => {
    if (names.length > 0) ensureCards(names)
  }, [names, ensureCards])

  if (!deck.hasCards) return <pre className="decklist-text">{text}</pre>

  const loading = names.some((name) => !(cardKey(name) in cardInfo))

  const showPreview = (e, info) => {
    if (canHover && info?.image) setPreview({ src: info.image, x: e.clientX, y: e.clientY })
  }
  const movePreview = (e) => {
    if (canHover) setPreview((p) => (p ? { ...p, x: e.clientX, y: e.clientY } : p))
  }
  const pinPreview = (info) => {
    if (!canHover && info?.image) setPreview({ src: info.image, pinned: true })
  }

  const renderCard = (card) => (
    <div
      key={card.name}
      className="deck-card"
      onMouseEnter={(e) => showPreview(e, card.info)}
      onMouseMove={movePreview}
      onMouseLeave={() => setPreview(null)}
      onClick={() => pinPreview(card.info)}
    >
      <span className="deck-card-count">{card.count}</span>
      <span className="deck-card-name">{card.name}</span>
      {card.info?.manaCost && <ManaCost cost={card.info.manaCost} />}
    </div>
  )

  const withInfo = (entries) => entries.map((entry) => ({ ...entry, info: cardInfo[cardKey(entry.name)] ?? null }))

  const renderMain = () => {
    if (loading) {
      return (
        <div className="deck-columns">
          <div className="deck-group">{withInfo(deck.main).map(renderCard)}</div>
        </div>
      )
    }
    return (
      <div className="deck-columns">
        {groupByType(deck.main, cardInfo).map((group) => (
          <div key={group.key} className="deck-group">
            <div className="deck-group-title">
              {group.label} ({group.total})
            </div>
            {group.cards.map(renderCard)}
          </div>
        ))}
      </div>
    )
  }

  const renderFlat = (entries) => (
    <div className="deck-columns">
      <div className="deck-group">
        {withInfo([...entries].sort((a, b) => a.name.localeCompare(b.name))).map(renderCard)}
      </div>
    </div>
  )

  let previewStyle = null
  if (preview && !preview.pinned) {
    const left = preview.x + 18 + PREVIEW_WIDTH > window.innerWidth - 8 ? preview.x - 18 - PREVIEW_WIDTH : preview.x + 18
    const top = Math.min(Math.max(preview.y - PREVIEW_HEIGHT / 2, 8), window.innerHeight - PREVIEW_HEIGHT - 8)
    previewStyle = { left, top }
  }

  return (
    <div className="deckview">
      <div className="deck-toolbar">
        <span className="muted small">
          {deck.totals.main} cards{deck.totals.sideboard > 0 ? ` · ${deck.totals.sideboard} sideboard` : ''}
          {loading ? ' · loading card details…' : ''}
        </span>
        <button className="link-btn" onClick={() => setRaw((r) => !r)}>
          {raw ? 'Card view' : 'Text view'}
        </button>
      </div>

      {raw ? (
        <pre className="decklist-text">{text}</pre>
      ) : (
        <>
          {deck.companion.length > 0 && (
            <div className="deck-section">
              <div className="deck-section-title">Companion</div>
              {renderFlat(deck.companion)}
            </div>
          )}
          {deck.commander.length > 0 && (
            <div className="deck-section">
              <div className="deck-section-title">Commander</div>
              {renderFlat(deck.commander)}
            </div>
          )}
          <div className="deck-section">
            <div className="deck-section-title">Main Deck ({deck.totals.main})</div>
            {renderMain()}
          </div>
          {deck.sideboard.length > 0 && (
            <div className="deck-section">
              <div className="deck-section-title">Sideboard ({deck.totals.sideboard})</div>
              {renderFlat(deck.sideboard)}
            </div>
          )}
          {deck.unparsed.length > 0 && (
            <p className="muted small">Couldn't read these lines: {deck.unparsed.join(' · ')}</p>
          )}
        </>
      )}

      {preview && !preview.pinned && <img className="card-preview" src={preview.src} alt="" style={previewStyle} />}
      {preview?.pinned && (
        <div className="card-preview-modal" onClick={() => setPreview(null)}>
          <img src={preview.src} alt="" />
        </div>
      )}
    </div>
  )
}
