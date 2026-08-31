import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, startNextHand, viewFor, cardCount } from '../js/game.js';

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan'];

// Deck layout: seats 0-3 get slices of 5, last 4 are the kitty, deck[20] is
// the up card. Seat 0 holds the top five spades; up card is the 9S.
const MONSTER_DECK = [
  'JS', 'JC', 'AS', 'KS', 'QS',
  '10S', '9H', '10H', 'JH', 'QH',
  'KH', 'AH', '9C', '10C', 'QC',
  'KC', 'AC', '9D', '10D', 'JD',
  '9S', 'QD', 'KD', 'AD',
];

function game(overrides = {}) {
  return newGame({ names: NAMES, firstDealer: 3, deck: MONSTER_DECK, ...overrides });
}

function run(state, steps) {
  for (const [seat, action] of steps) {
    const r = applyAction(state, seat, action);
    assert.ok(r.ok, `seat ${seat} ${JSON.stringify(action)}: ${r.error}`);
  }
}

const play = (seat, cardId) => [seat, { type: 'play', cardId }];

test('order up: dealer picks up and discards, then left of dealer leads', () => {
  const s = game();
  assert.equal(s.phase, 'bid1');
  assert.equal(s.turn, 0);
  run(s, [[0, { type: 'orderUp' }]]);
  assert.equal(s.phase, 'discard');
  assert.equal(s.turn, 3);
  assert.equal(s.hands[3].length, 6);
  assert.equal(s.trump, 'S');
  assert.equal(s.maker, 0);
  assert.equal(cardCount(s), 24);
  run(s, [[3, { type: 'discard', cardId: 'KC' }]]);
  assert.equal(s.phase, 'play');
  assert.equal(s.turn, 0);
  assert.equal(s.hands[3].length, 5);
  assert.equal(cardCount(s), 24);
});

test('taking all five tricks is a march worth 2', () => {
  const s = game();
  run(s, [[0, { type: 'orderUp' }], [3, { type: 'discard', cardId: 'KC' }]]);
  run(s, [
    play(0, 'JS'), play(1, '10S'), play(2, 'KH'), play(3, '9S'),
    play(0, 'JC'), play(1, '9H'), play(2, 'AH'), play(3, 'AC'),
    play(0, 'AS'), play(1, '10H'), play(2, '9C'), play(3, '9D'),
    play(0, 'KS'), play(1, 'JH'), play(2, '10C'), play(3, '10D'),
    play(0, 'QS'), play(1, 'QH'), play(2, 'QC'), play(3, 'JD'),
  ]);
  assert.equal(s.phase, 'handOver');
  assert.deepEqual(s.tricksWon, [5, 0]);
  assert.deepEqual(s.scores, [2, 0]);
  assert.equal(s.handResult.type, 'march');
  assert.equal(cardCount(s), 24);
  startNextHand(s);
  assert.equal(s.dealer, 0);
  assert.equal(s.handNumber, 2);
  assert.equal(s.phase, 'bid1');
});

test('makers taking fewer than 3 tricks are euchred for 2', () => {
  const s = game();
  // Seat 1 orders up into seat 0's monster hand.
  run(s, [[0, { type: 'pass' }], [1, { type: 'orderUp' }], [3, { type: 'discard', cardId: 'KC' }]]);
  assert.equal(s.maker, 1);
  run(s, [
    play(0, 'JS'), play(1, '10S'), play(2, 'KH'), play(3, '9S'),
    play(0, 'JC'), play(1, '9H'), play(2, 'AH'), play(3, 'AC'),
    play(0, 'AS'), play(1, '10H'), play(2, '9C'), play(3, '9D'),
    play(0, 'KS'), play(1, 'JH'), play(2, '10C'), play(3, '10D'),
    play(0, 'QS'), play(1, 'QH'), play(2, 'QC'), play(3, 'JD'),
  ]);
  assert.equal(s.handResult.type, 'euchre');
  assert.equal(s.handResult.scoringTeam, 0);
  assert.deepEqual(s.scores, [2, 0]);
});

test('going alone: partner sits out, lone march scores 4', () => {
  const s = game();
  run(s, [[0, { type: 'orderUp', alone: true }], [3, { type: 'discard', cardId: 'KC' }]]);
  assert.equal(s.skipSeat, 2);
  run(s, [
    play(0, 'JS'), play(1, '10S'), play(3, '9S'),
    play(0, 'JC'), play(1, '9H'), play(3, 'AC'),
    play(0, 'AS'), play(1, '10H'), play(3, '9D'),
    play(0, 'KS'), play(1, 'JH'), play(3, '10D'),
    play(0, 'QS'), play(1, 'QH'), play(3, 'JD'),
  ]);
  assert.equal(s.handResult.type, 'aloneMarch');
  assert.deepEqual(s.scores, [4, 0]);
  // Sitting-out partner never played a card.
  assert.equal(s.hands[2].length, 5);
});

test('ordering up alone when your partner dealt: dealer hand is dead, no pickup', () => {
  const s = game();
  run(s, [[0, { type: 'pass' }], [1, { type: 'orderUp', alone: true }]]);
  assert.equal(s.skipSeat, 3);
  assert.equal(s.phase, 'play'); // no discard phase
  assert.equal(s.hands[3].length, 5);
  assert.equal(s.kitty.length, 4);
  assert.equal(s.turn, 0);
});

test('all pass twice: turned suit cannot be called, stuck dealer must call', () => {
  const s = game();
  run(s, [
    [0, { type: 'pass' }], [1, { type: 'pass' }], [2, { type: 'pass' }], [3, { type: 'pass' }],
  ]);
  assert.equal(s.phase, 'bid2');
  assert.equal(s.turn, 0);
  assert.equal(viewFor(s, 0).turnedDown.id, '9S');
  assert.ok(!applyAction(s, 0, { type: 'call', suit: 'S' }).ok);
  run(s, [[0, { type: 'pass' }], [1, { type: 'pass' }], [2, { type: 'pass' }]]);
  assert.ok(!applyAction(s, 3, { type: 'pass' }).ok); // stick the dealer
  assert.ok(viewFor(s, 3).mustCall);
  run(s, [[3, { type: 'call', suit: 'H' }]]);
  assert.equal(s.trump, 'H');
  assert.equal(s.maker, 3);
  assert.equal(s.phase, 'play');
});

test('without stick the dealer, a full pass-out throws the hand in', () => {
  const s = game({ options: { stickTheDealer: false } });
  run(s, [
    [0, { type: 'pass' }], [1, { type: 'pass' }], [2, { type: 'pass' }], [3, { type: 'pass' }],
    [0, { type: 'pass' }], [1, { type: 'pass' }], [2, { type: 'pass' }], [3, { type: 'pass' }],
  ]);
  assert.equal(s.handNumber, 2);
  assert.equal(s.dealer, 0);
  assert.equal(s.phase, 'bid1');
  assert.equal(s.turn, 1);
});

test('illegal moves are rejected', () => {
  const s = game();
  assert.ok(!applyAction(s, 1, { type: 'pass' }).ok); // out of turn
  assert.ok(!applyAction(s, 0, { type: 'play', cardId: 'JS' }).ok); // wrong phase
  run(s, [[0, { type: 'orderUp' }], [3, { type: 'discard', cardId: 'KC' }]]);
  run(s, [play(0, 'JS')]);
  // Seat 1 holds the 10S and must follow suit.
  assert.ok(!applyAction(s, 1, { type: 'play', cardId: '9H' }).ok);
  assert.ok(applyAction(s, 1, { type: 'play', cardId: '10S' }).ok);
});

test('views are redacted: only your own cards are visible', () => {
  const s = game();
  const v = viewFor(s, 1);
  assert.deepEqual(v.hand.map((c) => c.id).sort(), ['10H', '10S', '9H', 'JH', 'QH']);
  assert.equal(v.hands, undefined);
  assert.equal(v.kitty, undefined);
  assert.deepEqual(v.handCounts, [5, 5, 5, 5]);
  assert.equal(v.upcard.id, '9S');
  // Dealer's discard choices are private too: during discard, others see counts only.
  run(s, [[0, { type: 'orderUp' }]]);
  const v3 = viewFor(s, 3);
  assert.equal(v3.legal.length, 6);
  assert.equal(viewFor(s, 0).legal, null);
});

test('reaching the target score ends the game', () => {
  const s = game();
  s.scores = [9, 8];
  run(s, [[0, { type: 'orderUp' }], [3, { type: 'discard', cardId: 'KC' }]]);
  run(s, [
    play(0, 'JS'), play(1, '10S'), play(2, 'KH'), play(3, '9S'),
    play(0, 'JC'), play(1, '9H'), play(2, 'AH'), play(3, 'AC'),
    play(0, 'AS'), play(1, '10H'), play(2, '9C'), play(3, '9D'),
    play(0, 'KS'), play(1, 'JH'), play(2, '10C'), play(3, '10D'),
    play(0, 'QS'), play(1, 'QH'), play(2, 'QC'), play(3, 'JD'),
  ]);
  assert.equal(s.phase, 'gameOver');
  assert.equal(s.winnerTeam, 0);
  assert.deepEqual(s.scores, [11, 8]);
  assert.ok(!applyAction(s, 0, { type: 'pass' }).ok);
});

test('a hand where the makers take 3 tricks scores 1 point', () => {
  const deck = [
    'JS', 'JC', 'AS', '9H', '9C',
    'KS', 'QS', 'AH', 'KH', 'QH',
    '10S', 'AC', 'KC', 'QC', '10C',
    'AD', 'KD', 'QD', 'JD', '10D',
    '9S', '10H', 'JH', '9D',
  ];
  const s = newGame({ names: NAMES, firstDealer: 3, deck });
  run(s, [[0, { type: 'orderUp' }], [3, { type: 'discard', cardId: '10D' }]]);
  run(s, [
    play(0, 'JS'), play(1, 'KS'), play(2, '10S'), play(3, '9S'),
    play(0, 'JC'), play(1, 'QS'), play(2, 'AC'), play(3, 'JD'),
    play(0, 'AS'), play(1, 'QH'), play(2, 'KC'), play(3, 'QD'),
    play(0, '9H'), play(1, 'AH'), play(2, 'QC'), play(3, 'KD'),
    play(1, 'KH'), play(2, '10C'), play(3, 'AD'), play(0, '9C'),
  ]);
  assert.equal(s.handResult.type, 'made');
  assert.deepEqual(s.tricksWon, [3, 2]);
  assert.deepEqual(s.scores, [1, 0]);
});
