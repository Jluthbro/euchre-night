// Card primitives and euchre ranking rules (bowers included).

export const SUITS = ['S', 'H', 'C', 'D'];
export const RANKS = ['9', '10', 'J', 'Q', 'K', 'A'];

export const SUIT_GLYPHS = { S: '♠', H: '♥', C: '♣', D: '♦' };
export const SUIT_NAMES = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds' };

export function isRed(suit) {
  return suit === 'H' || suit === 'D';
}

export function sameColorSuit(suit) {
  return { S: 'C', C: 'S', H: 'D', D: 'H' }[suit];
}

export function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: rank + suit, rank, suit });
    }
  }
  return deck;
}

export function cardFromId(id) {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { id, rank, suit };
}

export function isRightBower(card, trump) {
  return trump != null && card.rank === 'J' && card.suit === trump;
}

export function isLeftBower(card, trump) {
  return trump != null && card.rank === 'J' && card.suit === sameColorSuit(trump);
}

// The left bower counts as a trump-suit card for following suit and ranking.
export function effectiveSuit(card, trump) {
  return isLeftBower(card, trump) ? trump : card.suit;
}

const TRUMP_ORDER = { A: 5, K: 4, Q: 3, '10': 2, '9': 1 };
const PLAIN_ORDER = { A: 6, K: 5, Q: 4, J: 3, '10': 2, '9': 1 };

// Power of a card within a trick, given trump and the suit that was led.
// Trump > led suit > everything else.
export function trickRank(card, trump, ledSuit) {
  if (trump != null && effectiveSuit(card, trump) === trump) {
    if (isRightBower(card, trump)) return 207;
    if (isLeftBower(card, trump)) return 206;
    return 200 + TRUMP_ORDER[card.rank];
  }
  if (ledSuit != null && card.suit === ledSuit) {
    return 100 + PLAIN_ORDER[card.rank];
  }
  return PLAIN_ORDER[card.rank]; // never wins the trick, useful for sorting
}

// plays: [{seat, card}] in play order. Returns the winning play.
export function trickWinner(plays, trump) {
  const ledSuit = effectiveSuit(plays[0].card, trump);
  let best = plays[0];
  for (const play of plays.slice(1)) {
    if (trickRank(play.card, trump, ledSuit) > trickRank(best.card, trump, ledSuit)) {
      best = play;
    }
  }
  return best;
}

export function legalPlays(hand, trickPlays, trump) {
  if (trickPlays.length === 0) return [...hand];
  const ledSuit = effectiveSuit(trickPlays[0].card, trump);
  const followers = hand.filter((c) => effectiveSuit(c, trump) === ledSuit);
  return followers.length > 0 ? followers : [...hand];
}

// Sort for display: trump suit first, remaining suits alternating color,
// highest card first within each suit. Left bower sorts into trump.
export function sortHand(hand, trump) {
  let suitOrder;
  if (trump == null) {
    suitOrder = ['S', 'H', 'C', 'D'];
  } else {
    const others = SUITS.filter((s) => s !== trump);
    others.sort((a, b) => {
      const diff = (isRed(a) === isRed(trump) ? 1 : 0) - (isRed(b) === isRed(trump) ? 1 : 0);
      return diff !== 0 ? diff : SUITS.indexOf(a) - SUITS.indexOf(b);
    });
    suitOrder = [trump, ...others];
  }
  return [...hand].sort((a, b) => {
    const sa = suitOrder.indexOf(effectiveSuit(a, trump));
    const sb = suitOrder.indexOf(effectiveSuit(b, trump));
    if (sa !== sb) return sa - sb;
    return trickRank(b, trump, null) - trickRank(a, trump, null);
  });
}

// Deterministic RNG (mulberry32) so games and tests can be replayed by seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(arr, rand) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
