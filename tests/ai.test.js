import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, viewFor } from '../js/game.js';
import { decide, handStrength, bestDiscard } from '../js/ai.js';
import { cardFromId } from '../js/cards.js';

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan'];
const cards = (...ids) => ids.map(cardFromId);

test('hand strength ranks a two-bower hand above junk', () => {
  const monster = handStrength(cards('JS', 'JC', 'AS', 'KS', 'AH'), 'S');
  const junk = handStrength(cards('9H', '10C', 'QD', '9S', '10H'), 'S');
  assert.ok(monster > 8);
  assert.ok(junk < 3);
});

test('bot orders up a monster and goes alone', () => {
  const deck = [
    'JS', 'JC', 'AS', 'KS', 'AH',
    '10S', '9H', '10H', 'JH', 'QH',
    'KH', 'QS', '9C', '10C', 'QC',
    'KC', 'AC', '9D', '10D', 'JD',
    '9S', 'QD', 'KD', 'AD',
  ];
  const s = newGame({ names: NAMES, firstDealer: 3, deck });
  const action = decide(viewFor(s, 0));
  assert.equal(action.type, 'orderUp');
  assert.equal(action.alone, true);
});

test('bot passes on junk', () => {
  const deck = [
    '9H', '10C', 'QD', '9C', '10H',
    '10S', 'JS', 'JC', 'JH', 'QH',
    'KH', 'QS', 'AS', 'KS', 'QC',
    'KC', 'AC', '9D', '10D', 'JD',
    '9S', 'AD', 'KD', 'AH',
  ];
  const s = newGame({ names: NAMES, firstDealer: 3, deck });
  assert.equal(decide(viewFor(s, 0)).type, 'pass');
});

test('a stuck dealer always produces a legal call', () => {
  const deck = [
    '9H', '10C', 'QD', '9C', '10H',
    '10S', 'JS', 'JC', 'JH', 'QH',
    'KH', 'QS', 'AS', 'KS', 'QC',
    'KC', 'AC', '9D', '10D', 'JD',
    '9S', 'AD', 'KD', 'AH',
  ];
  const s = newGame({ names: NAMES, firstDealer: 3, deck });
  for (const seat of [0, 1, 2, 3, 0, 1, 2]) {
    assert.ok(applyAction(s, seat, { type: 'pass' }).ok);
  }
  const action = decide(viewFor(s, 3));
  assert.equal(action.type, 'call');
  assert.notEqual(action.suit, 'S');
  assert.ok(applyAction(s, 3, action).ok);
});

test('bestDiscard keeps trump and aces', () => {
  const six = cards('JS', 'JC', 'AS', 'AH', '9D', '9S');
  const discard = bestDiscard(six, 'S');
  assert.equal(discard.id, '9D');
});
