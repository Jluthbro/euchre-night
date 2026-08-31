// Protocol-level tests for online play, with PeerJS stubbed out. Covers
// seat assignment, redaction of views sent over the wire, bot takeover on
// disconnect, and rejoining to reclaim a seat.

import test from 'node:test';
import assert from 'node:assert/strict';

class FakePeer {
  constructor(id) {
    this.id = id;
    this.handlers = {};
    FakePeer.last = this;
    queueMicrotask(() => this.handlers.open && this.handlers.open(id));
  }
  on(event, cb) { this.handlers[event] = cb; }
  destroy() { this.destroyed = true; }
}

function fakeConn() {
  return {
    open: true,
    sent: [],
    handlers: {},
    send(m) { this.sent.push(m); },
    on(e, cb) { this.handlers[e] = cb; },
    close() { this.open = false; this.handlers.close && this.handlers.close(); },
    fire(e, d) { this.handlers[e] && this.handlers[e](d); },
    last(type) { return [...this.sent].reverse().find((m) => m.t === type); },
  };
}

globalThis.window = { Peer: FakePeer };
const { NetHost } = await import('../js/net.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeHost() {
  const events = { code: null, lobbies: [], states: [], errors: [] };
  const host = new NetHost({
    hostName: 'Justin',
    options: { stickTheDealer: true },
    callbacks: {
      onCode: (c) => { events.code = c; },
      onLobby: (l) => events.lobbies.push(l),
      onState: (v) => events.states.push(v),
      onError: (e) => events.errors.push(e),
    },
  });
  return { host, events, peer: FakePeer.last };
}

function join(peer, name) {
  const conn = fakeConn();
  peer.handlers.connection(conn);
  conn.fire('data', { t: 'hello', name, proto: 1 });
  return conn;
}

test('players get seats, redacted views, and validated actions', async () => {
  const { host, events, peer } = makeHost();
  await tick();
  assert.ok(/^[A-Z2-9]{5}$/.test(events.code), `bad code: ${events.code}`);

  const sam = join(peer, 'Sam');
  assert.equal(sam.last('welcome').seat, 1);
  assert.equal(sam.last('lobby').lobby.seats[1].name, 'Sam');

  host.startGame();
  const view = sam.last('view').view;
  assert.equal(view.you, 1);
  assert.equal(view.hand.length, 5);
  assert.equal(view.hands, undefined); // other hands never leave the host
  assert.equal(view.phase, 'bid1');
  assert.deepEqual(view.seatKinds, ['human', 'human', 'bot', 'bot']);

  // Host view flows through the local callback.
  assert.equal(events.states.at(-1).you, 0);

  // Out-of-turn action from the wire is rejected without crashing.
  const before = sam.sent.length;
  const turnBefore = sam.last('view').view.turn;
  if (turnBefore !== 1) {
    sam.fire('data', { t: 'act', a: { type: 'pass' } });
    assert.equal(sam.sent.length, before);
  }
  host.close();
});

test('a full table rejects a fifth player', async () => {
  const { host, peer } = makeHost();
  await tick();
  join(peer, 'Sam');
  join(peer, 'Pat');
  join(peer, 'Lee');
  const fifth = join(peer, 'Moe');
  assert.match(fifth.last('err').msg, /full/i);
  host.close();
});

test('disconnect hands the seat to a bot; rejoining by name reclaims it', async () => {
  const { host, peer } = makeHost();
  await tick();
  const sam = join(peer, 'Sam');
  host.startGame();
  // First dealer is seat 3, so the host bids first; pass the turn to Sam.
  host.submitLocal({ type: 'pass' });
  assert.equal(host.game.state.turn, 1);

  sam.close();
  assert.equal(host.seatMeta[1].kind, 'bot');

  // The bot should pick up Sam's turn on its own (turn timer).
  const logBefore = host.game.state.log.length;
  await sleep(1800);
  assert.ok(host.game.state.log.length > logBefore, 'bot did not act after takeover');

  const sam2 = join(peer, 'Sam');
  assert.equal(sam2.last('welcome').seat, 1);
  assert.equal(host.seatMeta[1].kind, 'human');
  const view = sam2.last('view').view;
  assert.equal(view.you, 1);
  assert.equal(view.hand.length + view.playedThisHand.filter((p) => p.seat === 1).length, 5);
  host.close();
});

test('everyone joining before start fills seats in order', async () => {
  const { host, peer } = makeHost();
  await tick();
  const a = join(peer, 'Ada');
  const b = join(peer, 'Ben');
  const c = join(peer, 'Cyd');
  assert.equal(a.last('welcome').seat, 1);
  assert.equal(b.last('welcome').seat, 2);
  assert.equal(c.last('welcome').seat, 3);
  // Duplicate names get disambiguated.
  b.close();
  const b2 = join(peer, 'Ada');
  assert.equal(b2.last('welcome').seat, 2);
  const lobby = b2.last('lobby').lobby;
  assert.notEqual(lobby.seats[2].name.toLowerCase(), lobby.seats[1].name.toLowerCase());
  host.close();
});
