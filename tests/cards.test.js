import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck,
  effectiveSuit,
  isRightBower,
  isLeftBower,
  trickWinner,
  legalPlays,
  sortHand,
  cardFromId,
  mulberry32,
  shuffled,
} from '../js/cards.js';

const c = cardFromId;
const plays = (...ids) => ids.map((id, i) => ({ seat: i, card: c(id) }));

test('deck has 24 unique cards, 9 through ace', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 24);
  assert.equal(new Set(deck.map((x) => x.id)).size, 24);
  assert.ok(deck.every((x) => ['9', '10', 'J', 'Q', 'K', 'A'].includes(x.rank)));
});

test('bower identification and effective suit', () => {
  assert.ok(isRightBower(c('JH'), 'H'));
  assert.ok(isLeftBower(c('JD'), 'H'));
  assert.ok(!isLeftBower(c('JS'), 'H'));
  assert.equal(effectiveSuit(c('JD'), 'H'), 'H'); // left bower is a heart
  assert.equal(effectiveSuit(c('JD'), 'D'), 'D'); // ...unless diamonds is trump
  assert.equal(effectiveSuit(c('JS'), 'C'), 'C'); // left bower for clubs
  assert.equal(effectiveSuit(c('9D'), 'H'), 'D');
});

test('right bower beats left bower beats ace of trump', () => {
  const winner = trickWinner(plays('AS', 'JC', 'JS', '9S'), 'S');
  assert.equal(winner.card.id, 'JS');
  const winner2 = trickWinner(plays('AS', 'JC', 'KS', '9S'), 'S');
  assert.equal(winner2.card.id, 'JC');
});

test('any trump beats any off-suit card, else highest of led suit wins', () => {
  assert.equal(trickWinner(plays('AH', 'KH', '9S', 'QH'), 'S').card.id, '9S');
  assert.equal(trickWinner(plays('10H', 'KH', '9C', 'AD'), 'S').card.id, 'KH');
});

test('off-suit jack is an ordinary card', () => {
  // Trump hearts: JS is just a spade, loses to QS.
  assert.equal(trickWinner(plays('9S', 'JS', 'QS', '10S'), 'H').card.id, 'QS');
});

test('must follow with the left bower when trump is led', () => {
  // Trump hearts, hearts led; hand holds JD (left bower) and 9D.
  const legal = legalPlays([c('JD'), c('9D')], plays('AH'), 'H');
  assert.deepEqual(legal.map((x) => x.id), ['JD']);
});

test('left bower does not count as its printed suit', () => {
  // Trump hearts, diamonds led; JD is a heart, so 9D is the only diamond.
  const legal = legalPlays([c('JD'), c('9D')], plays('AD'), 'H');
  assert.deepEqual(legal.map((x) => x.id), ['9D']);
});

test('void in led suit means any card is legal', () => {
  const hand = [c('9C'), c('AH')];
  const legal = legalPlays(hand, plays('AS'), 'H');
  assert.equal(legal.length, 2);
});

test('leader may play anything', () => {
  const hand = [c('9C'), c('AH')];
  assert.equal(legalPlays(hand, [], 'H').length, 2);
});

test('sortHand groups left bower with trump, highest first', () => {
  const sorted = sortHand([c('9H'), c('JD'), c('AS'), c('JH'), c('QC')], 'H');
  assert.deepEqual(sorted.map((x) => x.id).slice(0, 3), ['JH', 'JD', '9H']);
});

test('seeded shuffle is deterministic', () => {
  const a = shuffled(makeDeck(), mulberry32(42)).map((x) => x.id);
  const b = shuffled(makeDeck(), mulberry32(42)).map((x) => x.id);
  assert.deepEqual(a, b);
});
