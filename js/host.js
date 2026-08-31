// GameHost drives one table: it owns the authoritative engine state, runs
// bot turns on timers, and hands out per-seat views. Used directly for solo
// play and wrapped by the network host for online games.

import { newGame, applyAction, startNextHand, viewFor, renameSeat } from './game.js';
import { decide } from './ai.js';

export const BOT_NAMES = ['Marge', 'Gus', 'Lefty', 'Doc'];

const BOT_DELAY_MS = [650, 1400];
const NEXT_HAND_DELAY_MS = 5200;

export class GameHost {
  // seats: [{name, kind: 'human' | 'bot'}] — four entries, seat 0 first.
  constructor({ seats, options, seed }) {
    this.seats = seats.map((s) => ({ ...s }));
    this.options = { ...options };
    this.seed = seed;
    this.listeners = new Set();
    this.timer = null;
    this.state = null;
  }

  start() {
    this.state = newGame({
      names: this.seats.map((s) => s.name),
      options: this.options,
      seed: this.seed,
    });
    this.afterChange();
  }

  rematch() {
    if (!this.state || this.state.phase !== 'gameOver') return;
    this.seed = undefined;
    this.start();
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  viewFor(seat) {
    const view = viewFor(this.state, seat);
    view.seatKinds = this.seats.map((s) => s.kind);
    return view;
  }

  submit(seat, action) {
    if (!this.state) return { ok: false, error: 'game not started' };
    const result = applyAction(this.state, seat, action);
    if (result.ok) this.afterChange();
    return result;
  }

  // Swap who controls a seat (a friend joins, or a friend disconnects and a
  // bot takes over their cards). Safe mid-game.
  setSeat(seat, { name, kind }) {
    this.seats[seat] = { name, kind };
    if (this.state) {
      renameSeat(this.state, seat, name);
      this.afterChange();
    }
  }

  afterChange() {
    for (const fn of this.listeners) fn();
    this.scheduleNext();
  }

  scheduleNext() {
    clearTimeout(this.timer);
    this.timer = null;
    const s = this.state;
    if (!s) return;
    if (s.phase === 'handOver') {
      this.timer = setTimeout(() => {
        startNextHand(s);
        this.afterChange();
      }, NEXT_HAND_DELAY_MS);
      return;
    }
    if (s.phase === 'gameOver') return;
    if (this.seats[s.turn].kind !== 'bot') return;
    const delay = BOT_DELAY_MS[0] + Math.random() * (BOT_DELAY_MS[1] - BOT_DELAY_MS[0]);
    const seat = s.turn;
    const turnStamp = `${s.handNumber}:${s.phase}:${s.playedThisHand.length}:${s.passCount}`;
    this.timer = setTimeout(() => {
      // Only act if the game is still waiting on the same bot turn.
      if (this.state !== s || s.turn !== seat || this.seats[seat].kind !== 'bot') return;
      if (`${s.handNumber}:${s.phase}:${s.playedThisHand.length}:${s.passCount}` !== turnStamp) return;
      const action = decide(this.viewFor(seat));
      if (action) this.submit(seat, action);
    }, delay);
  }

  destroy() {
    clearTimeout(this.timer);
    this.listeners.clear();
    this.state = null;
  }
}

export function pickBotName(taken) {
  const inUse = new Set(taken.map((n) => n.toLowerCase()));
  for (const name of BOT_NAMES) {
    if (!inUse.has(name.toLowerCase())) return name;
  }
  return 'Bot';
}
