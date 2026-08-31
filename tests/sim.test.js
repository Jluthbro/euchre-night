// Bulk smoke test: four bots play complete games across many seeds.
// Every action a bot proposes must be accepted by the engine, every game
// must terminate, and the 24-card invariant must hold throughout.

import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, applyAction, startNextHand, viewFor, cardCount } from '../js/game.js';
import { decide } from '../js/ai.js';

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan'];

function playFullGame(seed, options = {}) {
  const s = newGame({ names: NAMES, seed, options });
  let steps = 0;
  let hands = 0;
  while (s.phase !== 'gameOver') {
    assert.ok(++steps < 10000, `seed ${seed}: game did not terminate`);
    if (s.phase === 'handOver') {
      hands++;
      startNextHand(s);
      continue;
    }
    const seat = s.turn;
    const action = decide(viewFor(s, seat));
    const r = applyAction(s, seat, action);
    assert.ok(r.ok, `seed ${seed} hand ${s.handNumber} phase ${s.phase} seat ${seat} ${JSON.stringify(action)}: ${r.error}`);
    assert.equal(cardCount(s), 24, `seed ${seed}: card count broken`);
  }
  hands++;
  return { scores: s.scores, winnerTeam: s.winnerTeam, hands: s.handNumber };
}

test('bots complete 200 full games without illegal moves (stick the dealer)', () => {
  let totalHands = 0;
  const wins = [0, 0];
  for (let seed = 1; seed <= 200; seed++) {
    const result = playFullGame(seed);
    assert.ok(result.scores[result.winnerTeam] >= 10, `seed ${seed}: winner below 10`);
    assert.ok(result.scores[1 - result.winnerTeam] < 10, `seed ${seed}: both teams at 10`);
    totalHands += result.hands;
    wins[result.winnerTeam]++;
  }
  const avgHands = totalHands / 200;
  // Real euchre games run roughly 7-14 hands; wild averages mean broken bidding.
  assert.ok(avgHands > 5 && avgHands < 25, `average hands per game looks wrong: ${avgHands}`);
  // Neither team should dominate: seats are symmetric across seeds.
  assert.ok(wins[0] > 40 && wins[1] > 40, `suspicious win split: ${wins}`);
});

test('bots complete games with stick the dealer off (redeals allowed)', () => {
  for (let seed = 500; seed < 550; seed++) {
    const result = playFullGame(seed, { stickTheDealer: false });
    assert.ok(result.scores[result.winnerTeam] >= 10);
  }
});
