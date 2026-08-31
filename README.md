# Euchre Night ♠

Play euchre in the browser with your regular crew. Host a table, text your
friends a room code (or the invite link), and play to 10. Anyone who hasn't
shown up yet — or whose phone dies mid-game — is covered by a bot until they
take their seat.

**Play it:** https://jluthbro.github.io/euchre-night/

## How a game night works

1. One person opens the game and clicks **Host a table**. They get a
   5-letter room code and an invite link.
2. Friends open the same page, enter the code (or just tap the invite
   link), and take seats. Teams sit across from each other, filled in join
   order: host & 2nd joiner vs 1st & 3rd.
3. The host hits **Start game** whenever — empty seats are played by bots,
   and a late friend can join mid-game and take over a bot's cards.
4. If someone disconnects, a bot instantly picks up their hand; rejoining
   with the same name gets their seat back.

No accounts, no server to run: the host's browser is the game server, and
players connect directly to it over WebRTC (PeerJS handles the handshake
through its free public broker). The host just keeps their tab open.

There's also **Play now** — you plus three bots, zero setup — good for
practice or when it's only you at 11pm.

## Rules implemented

Standard 4-player euchre, 24-card deck (9–A), first team to **10**:

- Two rounds of bidding: order up the turned card, or call a different suit
  after it's turned down. Dealer picks up and buries a card when ordered up.
- Right bower / left bower, with the left bower following suit as trump.
- **Going alone** (lone hand): 4 points for a lone march.
- Scoring: 1 point for 3–4 tricks, 2 for a march, 2 to the defenders for a
  euchre, 4 for a lone march.
- **Stick the dealer** is on by default (toggle on the home screen): if
  everyone passes twice, the dealer must call. Turned off, the hand is
  thrown in and the deal moves on.

House rules not (yet) included: defending alone, farmer's hand / ace-no-face
redeals, and playing to 11. Easy to add — see the engine notes below.

## Running it locally

It's a static site — no build step, no dependencies. ES modules need a real
HTTP URL though, so serve the folder instead of double-clicking the file:

```bash
npm run serve        # python3 -m http.server 8000
# open http://localhost:8000
```

Run the test suite (Node 20+):

```bash
npm test
```

The tests cover the card/bower rules, bidding and scoring flows, redaction
of hidden information, and a 250-game bot-vs-bot simulation that fails on
any illegal move, stuck game, or unbalanced win rate.

## How it's put together

```
index.html        page skeleton
styles.css        table + card styling
js/cards.js       deck, bower logic, trick ranking, legal plays
js/game.js        rules engine: pure state machine, no DOM/network/timers
js/ai.js          bot bidding + card play (works from a redacted view)
js/host.js        GameHost: owns engine state, runs bot turns on timers
js/net.js         online play: PeerJS host (authoritative) + client
js/ui.js          DOM rendering
js/main.js        screens and session wiring
tests/            node:test suites, including full-game simulations
vendor/           peerjs.min.js (MIT), vendored so the CDN is optional
```

Design notes:

- **The engine is pure and seedable.** `newGame() → applyAction() → viewFor()`.
  Every rule lives in `game.js`/`cards.js` and is exercised by tests; the
  UI and network layers can't break the rules.
- **Nobody can peek.** Remote players only ever receive `viewFor(seat)` —
  their own cards plus public information. Hands stay in the host's memory,
  and the engine validates every action server-side (host-side).
- **Bots play fair**, deciding from the same redacted view a human gets.

## Ideas for later

- Table chat / emotes
- Bot difficulty levels (current bots bid on hand strength and count cards
  within a hand)
- Defending alone, play to 11, farmer's hand
- Sound effects and a proper deal animation
- A TURN server fallback for networks where WebRTC can't connect directly
