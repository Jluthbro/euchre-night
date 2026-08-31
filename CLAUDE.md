# Euchre Night — notes for future sessions

Static browser game, no build step, no runtime dependencies (PeerJS is
vendored in `vendor/`). The repo root is the site root. GitHub Pages
serves the `gh-pages` branch; CI mirrors `main` onto it after tests pass,
so never edit `gh-pages` directly.

## Commands

- `npm test` — full suite (node:test, Node 20+), including 250 simulated
  bot-vs-bot games. Run after ANY change to `js/game.js`, `js/cards.js`,
  or `js/ai.js`.
- `npm run serve` — local dev server (ES modules don't load over file://).

## Architecture rules

- `js/game.js` + `js/cards.js` are the rules engine: pure, seedable, no
  DOM/network/timers. All rule changes happen here, with tests.
- Remote players only ever receive `viewFor(seat)` — never full state.
  Anything added to the view is visible to that player; hidden info
  (other hands, the kitty) must stay out of it.
- Bots (`js/ai.js`) decide from the same redacted view a human gets.
  Don't let them read engine state directly.
- `js/host.js` owns timers (bot turns, next-hand delay). `js/net.js` is
  transport only; the host browser is authoritative and validates every
  incoming action via the engine.
- UI writes user-provided strings with textContent only, never innerHTML.

## Conventions

- Seats 0–3 clockwise, teams are seat % 2. Seat 0 is the local player for
  solo, and the host online. On screen, view rotation puts your own seat
  at the bottom (offset = (seat - you + 4) % 4 → bottom/left/top/right).
- Cards are `{id, rank, suit}` with ids like `'JH'`, `'10S'`.
