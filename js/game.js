// Euchre engine: pure game state + rules. No DOM, no network, no timers.
// Seats 0-3 clockwise; teams are seat % 2 (0&2 vs 1&3). Play proceeds to
// the left, i.e. seat + 1.

import {
  makeDeck,
  shuffled,
  mulberry32,
  legalPlays,
  trickWinner,
  sortHand,
  effectiveSuit,
  SUIT_GLYPHS,
  SUITS,
} from './cards.js';

export const TEAM_OF = (seat) => seat % 2;
export const PARTNER_OF = (seat) => (seat + 2) % 4;

const DEFAULT_OPTIONS = { stickTheDealer: true, targetScore: 10 };

export function newGame({ names, options = {}, seed, deck, firstDealer } = {}) {
  const state = {
    seed: seed ?? Math.floor(Math.random() * 2 ** 31),
    options: { ...DEFAULT_OPTIONS, ...options },
    names: names ? [...names] : ['South', 'West', 'North', 'East'],
    scores: [0, 0],
    // Dealer 3 means seat 0 bids and leads first in the opening hand.
    dealer: firstDealer ?? 3,
    handNumber: 0,
    winnerTeam: null,
    log: [],
  };
  state._rand = mulberry32(state.seed);
  state._fixedDeck = deck ?? null; // test hook: exact deal for the first hand only
  startHand(state);
  return state;
}

function log(state, text) {
  state.log.push(text);
  if (state.log.length > 80) state.log.splice(0, state.log.length - 80);
}

const name = (state, seat) => state.names[seat];
const glyph = (suit) => SUIT_GLYPHS[suit];

function startHand(state) {
  state.handNumber++;
  let deck;
  if (state._fixedDeck) {
    deck = state._fixedDeck.map((c) => (typeof c === 'string' ? { id: c, rank: c.slice(0, -1), suit: c.slice(-1) } : c));
    state._fixedDeck = null;
  } else {
    deck = shuffled(makeDeck(), state._rand);
  }
  state.hands = [deck.slice(0, 5), deck.slice(5, 10), deck.slice(10, 15), deck.slice(15, 20)];
  state.kitty = deck.slice(20);
  state.upcard = state.kitty[0];
  state.trump = null;
  state.maker = null;
  state.alone = false;
  state.skipSeat = null;
  state.passCount = 0;
  state.trickPlays = [];
  state.trickLeader = null;
  state.trickCount = 0;
  state.tricksWon = [0, 0];
  state.playedThisHand = [];
  state.lastTrick = null;
  state.handResult = null;
  state.phase = 'bid1';
  state.turn = (state.dealer + 1) % 4;
  log(state, `Hand ${state.handNumber} — ${name(state, state.dealer)} deals. Up card: ${state.upcard.rank}${glyph(state.upcard.suit)}.`);
}

function nextActiveSeat(state, seat) {
  let s = (seat + 1) % 4;
  if (s === state.skipSeat) s = (s + 1) % 4;
  return s;
}

function callTrump(state, seat, suit, alone) {
  state.trump = suit;
  state.maker = seat;
  state.alone = !!alone;
  state.skipSeat = state.alone ? PARTNER_OF(seat) : null;
}

function beginPlay(state) {
  state.phase = 'play';
  let leader = (state.dealer + 1) % 4;
  if (leader === state.skipSeat) leader = (leader + 1) % 4;
  state.trickLeader = leader;
  state.turn = leader;
  log(state, `Trump is ${glyph(state.trump)}. ${name(state, leader)} leads.`);
}

function playsPerTrick(state) {
  return state.alone ? 3 : 4;
}

function endHand(state) {
  const makerTeam = TEAM_OF(state.maker);
  const makerTricks = state.tricksWon[makerTeam];
  let scoringTeam;
  let points;
  let type;
  if (makerTricks >= 3) {
    scoringTeam = makerTeam;
    if (makerTricks === 5) {
      points = state.alone ? 4 : 2;
      type = state.alone ? 'aloneMarch' : 'march';
    } else {
      points = 1;
      type = state.alone ? 'aloneMade' : 'made';
    }
  } else {
    scoringTeam = 1 - makerTeam;
    points = 2;
    type = 'euchre';
  }
  state.scores[scoringTeam] += points;
  state.handResult = {
    makerTeam,
    scoringTeam,
    maker: state.maker,
    alone: state.alone,
    tricks: [...state.tricksWon],
    points,
    type,
  };
  const desc = {
    made: 'makes it',
    aloneMade: 'makes it alone',
    march: 'takes all five — a march!',
    aloneMarch: 'takes all five ALONE!',
    euchre: 'is euchred!',
  }[type];
  log(state, `${name(state, state.maker)}'s team ${desc} +${points} to ${type === 'euchre' ? 'the defenders' : 'the makers'}. Score: ${state.scores[0]}–${state.scores[1]}.`);
  if (state.scores[scoringTeam] >= state.options.targetScore) {
    state.phase = 'gameOver';
    state.winnerTeam = scoringTeam;
    log(state, `${name(state, scoringTeam)} & ${name(state, scoringTeam + 2)} win the game ${state.scores[scoringTeam]}–${state.scores[1 - scoringTeam]}!`);
  } else {
    state.phase = 'handOver';
  }
}

export function startNextHand(state) {
  if (state.phase !== 'handOver') return { ok: false, error: 'not between hands' };
  state.dealer = (state.dealer + 1) % 4;
  startHand(state);
  return { ok: true };
}

export function renameSeat(state, seat, newName) {
  state.names[seat] = newName;
}

const findCard = (hand, cardId) => hand.find((c) => c.id === cardId);

export function applyAction(state, seat, action) {
  if (!action || typeof action.type !== 'string') return { ok: false, error: 'bad action' };
  if (state.phase === 'handOver' || state.phase === 'gameOver') {
    return { ok: false, error: 'hand is over' };
  }
  if (seat !== state.turn) return { ok: false, error: 'not your turn' };

  switch (state.phase) {
    case 'bid1':
      if (action.type === 'pass') {
        log(state, `${name(state, seat)} passes.`);
        state.passCount++;
        if (state.passCount === 4) {
          state.phase = 'bid2';
          state.turn = (state.dealer + 1) % 4;
          log(state, `The ${state.upcard.rank}${glyph(state.upcard.suit)} is turned down.`);
        } else {
          state.turn = (state.turn + 1) % 4;
        }
        return { ok: true };
      }
      if (action.type === 'orderUp') {
        callTrump(state, seat, state.upcard.suit, action.alone);
        const verb = seat === state.dealer ? 'picks it up' : 'orders it up';
        log(state, `${name(state, seat)} ${verb}${state.alone ? ' and goes ALONE' : ''}.`);
        if (state.dealer === state.skipSeat) {
          // Dealer's hand is dead (partner went alone); the up card stays put.
          beginPlay(state);
        } else {
          state.hands[state.dealer].push(state.upcard);
          state.kitty = state.kitty.filter((c) => c.id !== state.upcard.id);
          state.phase = 'discard';
          state.turn = state.dealer;
        }
        return { ok: true };
      }
      return { ok: false, error: 'invalid bid action' };

    case 'discard': {
      if (action.type !== 'discard') return { ok: false, error: 'must discard' };
      const card = findCard(state.hands[seat], action.cardId);
      if (!card) return { ok: false, error: 'card not in hand' };
      state.hands[seat] = state.hands[seat].filter((c) => c.id !== card.id);
      state.kitty.push(card);
      log(state, `${name(state, seat)} discards.`);
      beginPlay(state);
      return { ok: true };
    }

    case 'bid2':
      if (action.type === 'pass') {
        if (seat === state.dealer) {
          if (state.options.stickTheDealer) {
            return { ok: false, error: 'stick the dealer — you must call trump' };
          }
          log(state, `${name(state, seat)} passes. Everyone passed — throwing it in.`);
          state.dealer = (state.dealer + 1) % 4;
          startHand(state);
          return { ok: true };
        }
        log(state, `${name(state, seat)} passes.`);
        state.turn = (state.turn + 1) % 4;
        return { ok: true };
      }
      if (action.type === 'call') {
        if (!SUITS.includes(action.suit)) return { ok: false, error: 'bad suit' };
        if (action.suit === state.upcard.suit) {
          return { ok: false, error: 'that suit was turned down' };
        }
        callTrump(state, seat, action.suit, action.alone);
        log(state, `${name(state, seat)} calls ${glyph(action.suit)}${state.alone ? ' and goes ALONE' : ''}.`);
        beginPlay(state);
        return { ok: true };
      }
      return { ok: false, error: 'invalid bid action' };

    case 'play': {
      if (action.type !== 'play') return { ok: false, error: 'must play a card' };
      const hand = state.hands[seat];
      const card = findCard(hand, action.cardId);
      if (!card) return { ok: false, error: 'card not in hand' };
      const legal = legalPlays(hand, state.trickPlays, state.trump);
      if (!legal.some((c) => c.id === card.id)) {
        return { ok: false, error: 'must follow suit' };
      }
      state.hands[seat] = hand.filter((c) => c.id !== card.id);
      state.trickPlays.push({ seat, card });
      state.playedThisHand.push({ seat, card });
      if (state.trickPlays.length === playsPerTrick(state)) {
        const winner = trickWinner(state.trickPlays, state.trump);
        state.tricksWon[TEAM_OF(winner.seat)]++;
        state.trickCount++;
        state.lastTrick = {
          plays: [...state.trickPlays],
          winner: winner.seat,
          number: state.trickCount,
        };
        log(state, `${name(state, winner.seat)} takes trick ${state.trickCount}.`);
        state.trickPlays = [];
        state.trickLeader = winner.seat;
        state.turn = winner.seat;
        if (state.trickCount === 5) endHand(state);
      } else {
        state.turn = nextActiveSeat(state, seat);
      }
      return { ok: true };
    }

    default:
      return { ok: false, error: `no actions in phase ${state.phase}` };
  }
}

// What one seat is allowed to know. This is the only thing ever sent to
// remote players, so hidden cards stay on the host.
export function viewFor(state, seat) {
  const inBid2 = state.phase === 'bid2';
  const myTurn = state.turn === seat;
  return {
    you: seat,
    names: [...state.names],
    scores: [...state.scores],
    dealer: state.dealer,
    phase: state.phase,
    turn: state.turn,
    handNumber: state.handNumber,
    trump: state.trump,
    maker: state.maker,
    alone: state.alone,
    skipSeat: state.skipSeat,
    upcard: state.phase === 'bid1' ? state.upcard : null,
    turnedDown: inBid2 ? state.upcard : null,
    hand: sortHand(state.hands[seat], state.trump),
    handCounts: state.hands.map((h) => h.length),
    trickPlays: state.trickPlays.map((p) => ({ ...p })),
    trickLeader: state.trickLeader,
    trickCount: state.trickCount,
    tricksWon: [...state.tricksWon],
    playedThisHand: state.playedThisHand.map((p) => ({ ...p })),
    lastTrick: state.lastTrick,
    handResult: state.handResult,
    winnerTeam: state.winnerTeam,
    options: { ...state.options },
    mustCall:
      inBid2 && myTurn && seat === state.dealer && state.options.stickTheDealer,
    legal:
      state.phase === 'play' && myTurn
        ? legalPlays(state.hands[seat], state.trickPlays, state.trump).map((c) => c.id)
        : state.phase === 'discard' && myTurn
          ? state.hands[seat].map((c) => c.id)
          : null,
    log: state.log.slice(-40),
  };
}

// Debug/test helper: hands + kitty + cards played this hand must be 24.
// (Cards in the current trick are already counted in playedThisHand.)
export function cardCount(state) {
  return (
    state.hands.reduce((n, h) => n + h.length, 0) +
    state.kitty.length +
    state.playedThisHand.length
  );
}
