// Online play over WebRTC data channels (PeerJS). The host browser is the
// authoritative server: it owns the GameHost, remote players only ever see
// their own redacted views and submit actions for validation.

import { GameHost, pickBotName } from './host.js';

const PROTO = 1;
const ID_PREFIX = 'euchre-night-v1-';
// No ambiguous characters (0/O, 1/I/L) — codes get read out loud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(len = 5) {
  let code = '';
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code;
}

export function normalizeCode(raw) {
  return (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function peerAvailable() {
  return typeof window !== 'undefined' && typeof window.Peer === 'function';
}

function newPeer(id) {
  return id ? new window.Peer(id) : new window.Peer();
}

export class NetHost {
  constructor({ hostName, options, callbacks }) {
    this.hostName = hostName;
    this.options = options;
    this.cb = callbacks; // {onCode, onLobby, onError, onState}
    this.game = null;
    this.started = false;
    this.peer = null;
    this.code = null;
    // Seat 0 is the host. Others start open; bots fill them at start time.
    this.seatMeta = [
      { name: hostName, kind: 'human', conn: null, lastHumanName: hostName },
      ...[1, 2, 3].map(() => ({ name: null, kind: 'open', conn: null, lastHumanName: null })),
    ];
    this.closed = false;
    this.openPeer();
  }

  openPeer(attempt = 0) {
    this.code = randomCode();
    const peer = newPeer(ID_PREFIX + this.code);
    this.peer = peer;
    peer.on('open', () => {
      if (this.closed) return;
      this.cb.onCode(this.code);
      this.emitLobby();
    });
    peer.on('connection', (conn) => this.handleConnection(conn));
    peer.on('error', (err) => {
      if (this.closed) return;
      if (err.type === 'unavailable-id' && attempt < 3) {
        this.openPeer(attempt + 1); // code collision: roll a new one
        return;
      }
      if (err.type === 'peer-unavailable') return; // stale conn attempt, ignore
      this.cb.onError(describePeerError(err));
    });
  }

  handleConnection(conn) {
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') this.handleHello(conn, msg);
      else if (msg.t === 'act') this.handleAct(conn, msg);
    });
    conn.on('close', () => this.handleLeave(conn));
    conn.on('error', () => this.handleLeave(conn));
  }

  handleHello(conn, msg) {
    if (msg.proto !== PROTO) {
      conn.send({ t: 'err', msg: 'Version mismatch — ask everyone to refresh the page.' });
      setTimeout(() => conn.close(), 400);
      return;
    }
    const name = sanitizeName(msg.name);
    // Prefer giving a rejoining player their old seat back (matched by name),
    // otherwise the first open/bot seat.
    let seat = this.seatMeta.findIndex(
      (m, i) => i > 0 && m.kind !== 'human' && m.lastHumanName && m.lastHumanName.toLowerCase() === name.toLowerCase()
    );
    if (seat === -1) {
      seat = this.seatMeta.findIndex((m, i) => i > 0 && m.kind !== 'human');
    }
    if (seat === -1) {
      conn.send({ t: 'err', msg: 'This table is full (4 players).' });
      setTimeout(() => conn.close(), 400);
      return;
    }
    const meta = this.seatMeta[seat];
    meta.conn = conn;
    meta.kind = 'human';
    meta.name = uniqueName(name, this.seatMeta.filter((_, i) => i !== seat).map((m) => m.name));
    meta.lastHumanName = meta.name;
    conn._seat = seat;
    conn.send({ t: 'welcome', seat, proto: PROTO });
    if (this.game) {
      this.game.setSeat(seat, { name: meta.name, kind: 'human' });
    } else {
      this.emitLobby();
    }
  }

  handleAct(conn, msg) {
    const seat = conn._seat;
    if (seat == null || !this.game) return;
    if (this.seatMeta[seat].conn !== conn) return;
    this.game.submit(seat, msg.a);
  }

  handleLeave(conn) {
    const seat = conn._seat;
    if (seat == null || this.closed) return;
    const meta = this.seatMeta[seat];
    if (meta.conn !== conn) return;
    meta.conn = null;
    if (this.game) {
      // A bot picks up their cards so the table keeps moving.
      meta.kind = 'bot';
      meta.name = pickBotName(this.seatMeta.map((m) => m.name || ''));
      this.game.setSeat(seat, { name: meta.name, kind: 'bot' });
    } else {
      meta.kind = 'open';
      meta.name = null;
      this.emitLobby();
    }
  }

  lobbySeats() {
    return this.seatMeta.map((m) => ({ name: m.name, kind: m.kind }));
  }

  emitLobby() {
    if (this.started || this.closed) return;
    const lobby = { phase: 'lobby', seats: this.lobbySeats(), code: this.code, options: this.options };
    this.cb.onLobby(lobby);
    for (const m of this.seatMeta) {
      if (m.conn && m.conn.open) m.conn.send({ t: 'lobby', lobby });
    }
  }

  startGame() {
    if (this.started) return;
    for (const m of this.seatMeta) {
      if (m.kind === 'open') {
        m.kind = 'bot';
        m.name = pickBotName(this.seatMeta.map((x) => x.name || ''));
      }
    }
    this.started = true;
    this.game = new GameHost({
      seats: this.seatMeta.map((m) => ({ name: m.name, kind: m.kind })),
      options: this.options,
    });
    this.game.onChange(() => this.broadcast());
    this.game.start();
  }

  rematch() {
    if (this.game) this.game.rematch();
  }

  broadcast() {
    if (!this.game || this.closed) return;
    this.cb.onState(this.game.viewFor(0));
    this.seatMeta.forEach((m, seat) => {
      if (seat > 0 && m.conn && m.conn.open) {
        m.conn.send({ t: 'view', view: this.game.viewFor(seat) });
      }
    });
  }

  submitLocal(action) {
    if (this.game) this.game.submit(0, action);
  }

  close() {
    this.closed = true;
    if (this.game) this.game.destroy();
    if (this.peer) this.peer.destroy();
  }
}

export class NetClient {
  constructor({ code, name, callbacks }) {
    this.cb = callbacks; // {onWelcome, onLobby, onView, onError, onClosed}
    this.code = normalizeCode(code);
    this.name = name;
    this.seat = null;
    this.closed = false;
    this.gotIn = false;

    const peer = newPeer();
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + this.code, { reliable: true });
      this.conn = conn;
      conn.on('open', () => conn.send({ t: 'hello', name: this.name, proto: PROTO }));
      conn.on('data', (msg) => this.handleData(msg));
      conn.on('close', () => this.handleClosed());
      conn.on('error', () => this.handleClosed());
    });
    peer.on('error', (err) => {
      if (this.closed) return;
      if (err.type === 'peer-unavailable') {
        this.cb.onError(`No table found with code ${this.code}. Check the code with your host.`);
      } else {
        this.cb.onError(describePeerError(err));
      }
    });
  }

  handleData(msg) {
    if (!msg || typeof msg !== 'object' || this.closed) return;
    switch (msg.t) {
      case 'welcome':
        this.gotIn = true;
        this.seat = msg.seat;
        this.cb.onWelcome(msg.seat);
        break;
      case 'lobby':
        this.cb.onLobby(msg.lobby);
        break;
      case 'view':
        this.cb.onView(msg.view);
        break;
      case 'err':
        this.cb.onError(msg.msg);
        this.close();
        break;
    }
  }

  handleClosed() {
    if (this.closed) return;
    this.closed = true;
    this.cb.onClosed(this.gotIn);
  }

  send(action) {
    if (this.conn && this.conn.open) this.conn.send({ t: 'act', a: action });
  }

  close() {
    this.closed = true;
    if (this.peer) this.peer.destroy();
  }
}

function sanitizeName(raw) {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name || 'Friend';
}

function uniqueName(name, others) {
  const taken = new Set(others.filter(Boolean).map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 10; i++) {
    if (!taken.has(`${name.toLowerCase()} ${i}`)) return `${name} ${i}`;
  }
  return name;
}

function describePeerError(err) {
  const type = err && err.type ? err.type : 'unknown';
  if (type === 'network' || type === 'server-error' || type === 'socket-error' || type === 'socket-closed') {
    return 'Lost contact with the matchmaking server. Check your connection and try again.';
  }
  if (type === 'browser-incompatible') {
    return 'This browser does not support WebRTC — try Chrome, Edge, Firefox, or Safari.';
  }
  return `Connection problem (${type}). Try again.`;
}
