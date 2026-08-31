// Bot decision-making. Works entirely from a seat's redacted view (the same
// information a human at that seat would have), so bots can't cheat.

import {
  SUITS,
  effectiveSuit,
  isRightBower,
  isLeftBower,
  trickRank,
  legalPlays,
  cardFromId,
} from './cards.js';
import { TEAM_OF, PARTNER_OF } from './game.js';

const TRUMP_WEIGHT = { A: 2.2, K: 1.8, Q: 1.6, '10': 1.3, '9': 1.2 };

function cardWeight(card, trump) {
  if (isRightBower(card, trump)) return 3.0;
  if (isLeftBower(card, trump)) return 2.7;
  if (card.suit === trump) return TRUMP_WEIGHT[card.rank];
  if (card.rank === 'A') return 0.9;
  return 0;
}

export function handStrength(cards, trump) {
  let s = 0;
  let trumpCount = 0;
  const suitCounts = { S: 0, H: 0, C: 0, D: 0 };
  for (const c of cards) {
    s += cardWeight(c, trump);
    const eff = effectiveSuit(c, trump);
    suitCounts[eff]++;
    if (eff === trump) trumpCount++;
  }
  if (trumpCount >= 2) {
    for (const suit of SUITS) {
      if (suit !== trump && suitCounts[suit] === 0) s += 0.3;
    }
  }
  if (trumpCount >= 4) s += 0.5;
  return s;
}

// Best card to throw away from a 6-card hand, keeping the strongest 5.
export function bestDiscard(cards, trump) {
  let best = null;
  let bestStrength = -Infinity;
  for (const candidate of cards) {
    if (effectiveSuit(candidate, trump) === trump && cards.some((c) => effectiveSuit(c, trump) !== trump)) {
      continue; // never throw trump while off-suit cards remain
    }
    const rest = cards.filter((c) => c.id !== candidate.id);
    let strength = handStrength(rest, trump);
    // Tiebreak: prefer discarding low cards and shortening suits toward a void.
    const suitMates = rest.filter((c) => effectiveSuit(c, trump) === effectiveSuit(candidate, trump)).length;
    strength -= trickRank(candidate, trump, null) * 0.001;
    strength -= suitMates * 0.01;
    if (strength > bestStrength) {
      bestStrength = strength;
      best = candidate;
    }
  }
  return best;
}

const ORDER_THRESHOLD = 5.2;
const CALL_THRESHOLD = 5.0;
const ALONE_THRESHOLD = 7.9;

function wantsAlone(cards, trump, strength) {
  if (strength < ALONE_THRESHOLD) return false;
  const hasRight = cards.some((c) => isRightBower(c, trump));
  const hasLeft = cards.some((c) => isLeftBower(c, trump));
  return hasRight || (hasLeft && cards.some((c) => c.suit === trump && c.rank === 'A'));
}

function decideBid1(view) {
  const trump = view.upcard.suit;
  const me = view.you;
  let cards = view.hand;
  let strength;
  if (me === view.dealer) {
    // Evaluate the hand as it would look after picking up and discarding.
    const withUp = [...cards, view.upcard];
    const discard = bestDiscard(withUp, trump);
    cards = withUp.filter((c) => c.id !== discard.id);
    strength = handStrength(cards, trump);
  } else {
    strength = handStrength(cards, trump);
    const upWeight = cardWeight(view.upcard, trump);
    if (view.dealer === PARTNER_OF(me)) {
      strength += 0.4 + upWeight * 0.3; // partner gains the up card
    } else {
      strength -= 0.5 + upWeight * 0.3; // an opponent gains it
    }
  }
  if (strength >= ORDER_THRESHOLD) {
    return { type: 'orderUp', alone: wantsAlone(cards, trump, strength) };
  }
  return { type: 'pass' };
}

function decideBid2(view) {
  const banned = view.turnedDown.suit;
  let bestSuit = null;
  let bestStrength = -Infinity;
  for (const suit of SUITS) {
    if (suit === banned) continue;
    const s = handStrength(view.hand, suit);
    if (s > bestStrength) {
      bestStrength = s;
      bestSuit = suit;
    }
  }
  if (view.mustCall || bestStrength >= CALL_THRESHOLD) {
    return {
      type: 'call',
      suit: bestSuit,
      alone: wantsAlone(view.hand, bestSuit, bestStrength),
    };
  }
  return { type: 'pass' };
}

// A card nobody can beat within its effective suit: every higher card of
// that suit has already been played or is in my own hand.
function isBossCard(card, trump, view) {
  const suit = effectiveSuit(card, trump);
  const myRank = trickRank(card, trump, suit);
  const seen = new Set([
    ...view.playedThisHand.map((p) => p.card.id),
    ...view.hand.map((c) => c.id),
  ]);
  for (const s of SUITS) {
    for (const r of ['9', '10', 'J', 'Q', 'K', 'A']) {
      const other = cardFromId(r + s);
      if (effectiveSuit(other, trump) !== suit) continue;
      if (trickRank(other, trump, suit) > myRank && !seen.has(other.id)) {
        return false;
      }
    }
  }
  return true;
}

const byPowerAsc = (trump, ledSuit) => (a, b) =>
  trickRank(a, trump, ledSuit) - trickRank(b, trump, ledSuit);

function chooseThrowaway(legal, trump) {
  // Dump the weakest card: prefer non-trump, and hang on to aces.
  const nonTrump = legal.filter((c) => effectiveSuit(c, trump) !== trump);
  const pool = nonTrump.length > 0 ? nonTrump : legal;
  const sorted = [...pool].sort(byPowerAsc(trump, null));
  const nonAce = sorted.filter((c) => c.rank !== 'A');
  return nonAce.length > 0 ? nonAce[0] : sorted[0];
}

function decideLead(view) {
  const trump = view.trump;
  const hand = view.hand;
  const onMakerTeam = TEAM_OF(view.you) === TEAM_OF(view.maker);
  const myTrumps = hand
    .filter((c) => effectiveSuit(c, trump) === trump)
    .sort((a, b) => trickRank(b, trump, null) - trickRank(a, trump, null));
  // Makers with control pull trump out of opponents' hands.
  if (onMakerTeam && myTrumps.length >= 2 && isBossCard(myTrumps[0], trump, view)) {
    return { type: 'play', cardId: myTrumps[0].id };
  }
  const bossOffsuit = hand.filter(
    (c) => effectiveSuit(c, trump) !== trump && isBossCard(c, trump, view)
  );
  if (bossOffsuit.length > 0) {
    bossOffsuit.sort((a, b) => trickRank(b, trump, null) - trickRank(a, trump, null));
    return { type: 'play', cardId: bossOffsuit[0].id };
  }
  if (onMakerTeam && myTrumps.length > 0 && isBossCard(myTrumps[0], trump, view)) {
    return { type: 'play', cardId: myTrumps[0].id };
  }
  return { type: 'play', cardId: chooseThrowaway(hand, trump).id };
}

function decideFollow(view) {
  const trump = view.trump;
  const plays = view.trickPlays;
  const ledSuit = effectiveSuit(plays[0].card, trump);
  const legal = view.hand.filter((c) => view.legal.includes(c.id));
  const rank = (c) => trickRank(c, trump, ledSuit);

  let winning = plays[0];
  for (const p of plays) if (rank(p.card) > rank(winning.card)) winning = p;
  const partnerWinning = winning.seat === PARTNER_OF(view.you);
  const playersAfterMe = (view.alone ? 3 : 4) - plays.length - 1;

  if (partnerWinning && (playersAfterMe === 0 || isBossCard(winning.card, trump, view))) {
    return { type: 'play', cardId: chooseThrowaway(legal, trump).id };
  }
  const winners = legal.filter((c) => rank(c) > rank(winning.card)).sort(byPowerAsc(trump, ledSuit));
  if (winners.length > 0) {
    return { type: 'play', cardId: winners[0].id };
  }
  return { type: 'play', cardId: chooseThrowaway(legal, trump).id };
}

export function decide(view) {
  switch (view.phase) {
    case 'bid1':
      return decideBid1(view);
    case 'bid2':
      return decideBid2(view);
    case 'discard': {
      const discard = bestDiscard(view.hand, view.trump);
      return { type: 'discard', cardId: discard.id };
    }
    case 'play':
      return view.trickPlays.length === 0 ? decideLead(view) : decideFollow(view);
    default:
      return null;
  }
}
