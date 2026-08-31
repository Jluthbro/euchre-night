// DOM rendering. Everything is painted from a seat's view object; user-
// provided strings only ever land in textContent, never innerHTML.

import { SUIT_GLYPHS, SUIT_NAMES, isRed } from './cards.js';
import { TEAM_OF } from './game.js';

const $ = (sel) => document.querySelector(sel);

let handlers = {}; // {onAction, onStart, onRematch, onLeave, onRejoin}
let ctx = null;
let latestView = null;
let lobbyData = null;
let notice = null;
let shownTrickKey = null;
let lastPaintedHand = null;
let holdTrick = null;
let holdTimer = null;

const TRICK_HOLD_MS = 1500;

export function setHandlers(h) {
  handlers = h;
}

export function showScreen(which) {
  $('#screen-home').hidden = which !== 'home';
  $('#screen-table').hidden = which !== 'table';
  if (which === 'table') {
    latestView = null;
    lobbyData = null;
    notice = null;
    shownTrickKey = null;
    lastPaintedHand = null;
    holdTrick = null;
    clearTimeout(holdTimer);
    clearTable();
    refreshOverlay();
  } else {
    hideOverlay();
  }
}

function clearTable() {
  for (const id of ['seat-0', 'seat-1', 'seat-2', 'seat-3']) $('#' + id).replaceChildren();
  $('#upcardArea').replaceChildren();
  for (const slot of document.querySelectorAll('#trickArea .slot')) {
    slot.replaceChildren();
    slot.classList.remove('winner');
    slot.dataset.shown = '';
    slot.dataset.next = '';
  }
  $('#actionBar').replaceChildren();
  $('#handArea').replaceChildren();
  $('#ticker').textContent = '';
  $('#trumpChip').hidden = true;
  $('#roomChip').hidden = true;
  $('#scoreboard').replaceChildren();
  $('#logDrawer').hidden = true;
}

// ---------- cards ----------

function cardEl(card, { small = false, back = false, button = false, grayed = false } = {}) {
  const el = document.createElement(button ? 'button' : 'div');
  if (button) el.type = 'button';
  el.className = 'card' + (small ? ' small' : '') + (back ? ' back' : '');
  if (grayed) el.classList.add('facedown-note');
  if (!back) {
    if (isRed(card.suit)) el.classList.add('red');
    const glyph = SUIT_GLYPHS[card.suit];
    const corner = document.createElement('span');
    corner.className = 'corner';
    corner.textContent = `${card.rank}\n${glyph}`;
    const pip = document.createElement('span');
    pip.className = 'pip';
    pip.textContent = glyph;
    const corner2 = corner.cloneNode(true);
    corner2.classList.add('flip');
    el.append(corner, pip, corner2);
    el.setAttribute('aria-label', `${card.rank} of ${SUIT_NAMES[card.suit]}`);
  }
  return el;
}

function suitSpan(suit) {
  const s = document.createElement('span');
  s.textContent = SUIT_GLYPHS[suit];
  if (isRed(suit)) s.classList.add('red');
  return s;
}

// ---------- main render ----------

export function renderTable(view, context) {
  ctx = context;
  latestView = view;
  lobbyData = null;

  const trickKey = view.lastTrick ? `${view.handNumber}:${view.lastTrick.number}` : null;
  const sameHand = lastPaintedHand === view.handNumber;
  if (trickKey && trickKey !== shownTrickKey) {
    shownTrickKey = trickKey;
    if (sameHand || view.phase === 'handOver' || view.phase === 'gameOver') {
      // Hold the finished trick on the table so everyone sees who took it.
      holdTrick = view.lastTrick;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holdTrick = null;
        if (latestView) paint(latestView);
      }, TRICK_HOLD_MS);
    }
  }
  lastPaintedHand = view.handNumber;
  paint(view);
}

function paint(view) {
  paintTopbar(view);
  for (let seat = 0; seat < 4; seat++) paintSeat(view, seat);
  paintUpcard(view);
  paintTrick(view);
  paintTicker(view);
  paintActionBar(view);
  paintHand(view);
  paintLog(view);
  refreshOverlay();
}

function displayName(view, seat) {
  return seat === ctx.mySeat ? 'You' : view.names[seat];
}

function paintTopbar(view) {
  const roomChip = $('#roomChip');
  if (ctx.roomCode) {
    roomChip.hidden = false;
    roomChip.textContent = `Table ${ctx.roomCode} ⧉`;
  } else {
    roomChip.hidden = true;
  }

  const trumpChip = $('#trumpChip');
  if (view.trump) {
    trumpChip.hidden = false;
    trumpChip.replaceChildren('Trump ', suitSpan(view.trump));
    if (view.maker != null) {
      trumpChip.append(` · ${displayName(view, view.maker)}${view.alone ? ' (alone)' : ''}`);
    }
  } else {
    trumpChip.hidden = true;
  }

  const myTeam = TEAM_OF(ctx.mySeat);
  const board = $('#scoreboard');
  board.replaceChildren(
    scorePill('Us', view.scores[myTeam], view.tricksWon[myTeam], 'us'),
    scorePill('Them', view.scores[1 - myTeam], view.tricksWon[1 - myTeam], 'them')
  );
}

function scorePill(label, score, tricks, cls) {
  const pill = document.createElement('div');
  pill.className = `score-pill ${cls}`;
  const dot = document.createElement('span');
  dot.className = 'dot';
  const b = document.createElement('b');
  b.textContent = String(score);
  const t = document.createElement('span');
  t.className = 'tricks';
  t.textContent = `${tricks} trick${tricks === 1 ? '' : 's'}`;
  pill.append(dot, label + ' ', b, t);
  return pill;
}

function seatContainer(seat) {
  const offset = (seat - ctx.mySeat + 4) % 4;
  return $('#seat-' + offset);
}

const POS_CLASS = { 'seat-0': 'pos-bottom', 'seat-1': 'pos-left', 'seat-2': 'pos-top', 'seat-3': 'pos-right' };

function paintSeat(view, seat) {
  const el = seatContainer(seat);
  el.replaceChildren();
  el.className = 'seat ' + POS_CLASS[el.id];
  el.classList.add(TEAM_OF(seat) === TEAM_OF(ctx.mySeat) ? 'team-us' : 'team-them');
  const actionable = ['bid1', 'bid2', 'discard', 'play'].includes(view.phase);
  if (actionable && view.turn === seat) el.classList.add('turn');
  if (view.skipSeat === seat) el.classList.add('sitting-out');

  const plate = document.createElement('div');
  plate.className = 'plate';
  const avatar = document.createElement('span');
  avatar.className = 'avatar';
  avatar.textContent = (view.names[seat] || '?').slice(0, 1).toUpperCase();
  const pname = document.createElement('span');
  pname.className = 'pname';
  const isBot = view.seatKinds && view.seatKinds[seat] === 'bot';
  pname.textContent = displayName(view, seat) + (isBot ? ' 🤖' : '');
  plate.append(avatar, pname);
  if (view.dealer === seat) plate.append(tag('D', 'dealer'));
  if (view.maker === seat && view.trump) {
    const mk = tag('', 'maker');
    mk.append(suitSpan(view.trump));
    if (view.alone) mk.append(' alone');
    plate.append(mk);
  }
  if (view.skipSeat === seat) plate.append(tag('sitting out'));
  el.append(plate);

  if (seat !== ctx.mySeat) {
    const backs = document.createElement('div');
    backs.className = 'backs';
    const n = view.handCounts[seat];
    for (let i = 0; i < n; i++) backs.append(cardEl(null, { small: true, back: true }));
    el.append(backs);
  }
}

function tag(text, cls = '') {
  const t = document.createElement('span');
  t.className = 'tag' + (cls ? ' ' + cls : '');
  if (text) t.textContent = text;
  return t;
}

function paintUpcard(view) {
  const area = $('#upcardArea');
  area.replaceChildren();
  if (view.phase === 'bid1' && view.upcard) {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Up card';
    area.append(label, cardEl(view.upcard));
  } else if (view.phase === 'bid2' && view.turnedDown) {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = 'Turned down';
    area.append(label, cardEl(view.turnedDown, { grayed: true }));
  }
}

function paintTrick(view) {
  const showing = holdTrick ? holdTrick.plays : view.trickPlays;
  const winner = holdTrick ? holdTrick.winner : null;
  const slots = [
    $('#trickArea .slot-bottom'),
    $('#trickArea .slot-left'),
    $('#trickArea .slot-top'),
    $('#trickArea .slot-right'),
  ];
  for (const slot of slots) {
    // Skip the teardown/rebuild if the card is unchanged, so the landing
    // animation only plays when a card is actually placed.
    slot.dataset.next = '';
  }
  for (const play of showing) {
    const offset = (play.seat - ctx.mySeat + 4) % 4;
    slots[offset].dataset.next = play.card.id + (winner === play.seat ? '*' : '');
  }
  slots.forEach((slot) => {
    if (slot.dataset.next === slot.dataset.shown) return;
    slot.dataset.shown = slot.dataset.next;
    slot.replaceChildren();
    slot.classList.remove('winner');
    if (!slot.dataset.next) return;
    const id = slot.dataset.next.replace('*', '');
    const card = { id, rank: id.slice(0, -1), suit: id.slice(-1) };
    slot.append(cardEl(card));
    if (slot.dataset.next.endsWith('*')) slot.classList.add('winner');
  });
}

function paintTicker(view) {
  const last = view.log[view.log.length - 1] || '';
  $('#ticker').textContent = last;
}

function paintLog(view) {
  const list = $('#logList');
  list.replaceChildren();
  for (const line of view.log) {
    const li = document.createElement('li');
    li.textContent = line;
    list.append(li);
  }
  list.scrollTop = list.scrollHeight;
}

// ---------- action bar ----------

function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = 'btn' + (cls ? ' ' + cls : '');
  if (typeof label === 'string') b.textContent = label;
  else b.append(...label);
  b.addEventListener('click', onClick);
  return b;
}

function aloneToggle() {
  const label = document.createElement('label');
  label.className = 'alone-toggle';
  const ck = document.createElement('input');
  ck.type = 'checkbox';
  ck.id = 'aloneCk';
  label.append(ck, 'go alone');
  return label;
}

function prompt(...parts) {
  const p = document.createElement('span');
  p.className = 'prompt';
  p.append(...parts);
  return p;
}

function paintActionBar(view) {
  const bar = $('#actionBar');
  bar.replaceChildren();
  const my = view.turn === ctx.mySeat;
  const turnName = displayName(view, view.turn);
  const send = (a) => handlers.onAction && handlers.onAction(a);

  switch (view.phase) {
    case 'bid1': {
      if (!my) {
        bar.append(prompt(`Waiting for ${turnName} to bid…`));
        break;
      }
      const iAmDealer = ctx.mySeat === view.dealer;
      bar.append(
        prompt(iAmDealer ? 'Pick up the ' : 'Order up the ', suitSpan(view.upcard.suit), '?'),
        btn('Pass', 'quiet', () => send({ type: 'pass' })),
        btn(iAmDealer ? 'Pick it up' : 'Order it up', '', () =>
          send({ type: 'orderUp', alone: $('#aloneCk')?.checked || false })
        ),
        aloneToggle()
      );
      break;
    }
    case 'bid2': {
      if (!my) {
        bar.append(prompt(`Waiting for ${turnName} to call…`));
        break;
      }
      bar.append(prompt(view.mustCall ? 'Dealer is stuck — you must call trump:' : 'Call trump:'));
      for (const suit of ['S', 'H', 'C', 'D']) {
        if (suit === view.turnedDown.suit) continue;
        bar.append(btn([suitSpan(suit)], 'suit quiet', () =>
          send({ type: 'call', suit, alone: $('#aloneCk')?.checked || false })
        ));
      }
      if (!view.mustCall) bar.append(btn('Pass', 'quiet', () => send({ type: 'pass' })));
      bar.append(aloneToggle());
      break;
    }
    case 'discard':
      bar.append(prompt(my ? 'You picked it up — click a card below to bury.' : `${turnName} is discarding…`));
      break;
    case 'play':
      if (holdTrick) bar.append(prompt(`${displayName(view, holdTrick.winner)} take${holdTrick.winner === ctx.mySeat ? '' : 's'} the trick.`));
      else if (my) bar.append(prompt(view.trickPlays.length === 0 ? 'Your lead.' : 'Your turn.'));
      else bar.append(prompt(`${turnName} is thinking…`));
      break;
    case 'handOver':
      bar.append(prompt('Next hand coming up…'));
      break;
  }
}

// ---------- hand ----------

function paintHand(view) {
  const area = $('#handArea');
  area.replaceChildren();
  const my = view.turn === ctx.mySeat;
  for (const card of view.hand) {
    const b = cardEl(card, { button: true });
    let action = null;
    if (my && view.phase === 'play' && view.legal && view.legal.includes(card.id)) {
      action = { type: 'play', cardId: card.id };
    } else if (my && view.phase === 'discard') {
      action = { type: 'discard', cardId: card.id };
    }
    if (action) {
      b.classList.add('playable');
      b.addEventListener('click', () => handlers.onAction && handlers.onAction(action));
    } else {
      b.disabled = true;
      if (my && view.phase === 'play') b.classList.add('dim');
    }
    area.append(b);
  }
}

// ---------- overlays ----------

export function renderLobby(lobby, context) {
  ctx = { ...ctx, ...context };
  lobbyData = lobby;
  refreshOverlay();
}

export function showNotice(title, body, buttons = []) {
  notice = { title, body, buttons };
  refreshOverlay();
}

export function clearNotice() {
  notice = null;
  refreshOverlay();
}

function hideOverlay() {
  $('#overlay').hidden = true;
}

function refreshOverlay() {
  const overlay = $('#overlay');
  const card = $('#overlayCard');

  if (notice) {
    card.replaceChildren(h2(notice.title), para(notice.body), buttonRow(notice.buttons));
    overlay.hidden = false;
    return;
  }
  if (lobbyData) {
    paintLobby(card);
    overlay.hidden = false;
    return;
  }
  const view = latestView;
  if (view && view.phase === 'handOver' && !holdTrick) {
    paintHandResult(card, view);
    overlay.hidden = false;
    return;
  }
  if (view && view.phase === 'gameOver' && !holdTrick) {
    paintGameOver(card, view);
    overlay.hidden = false;
    return;
  }
  overlay.hidden = true;
}

function h2(text) {
  const el = document.createElement('h2');
  el.textContent = text;
  return el;
}

function para(text) {
  const el = document.createElement('p');
  el.textContent = text;
  return el;
}

function buttonRow(buttons) {
  const row = document.createElement('div');
  row.className = 'row';
  for (const spec of buttons) {
    row.append(btn(spec.label, spec.quiet ? 'quiet' : '', spec.onClick));
  }
  return row;
}

function paintLobby(card) {
  const lobby = lobbyData;
  card.replaceChildren();
  card.append(h2(ctx.isHost ? 'Your table is open' : 'You’re in!'));
  if (ctx.roomCode) {
    const code = document.createElement('div');
    code.className = 'code';
    code.textContent = ctx.roomCode;
    card.append(para('Friends join with this code:'), code);
  }
  const list = document.createElement('ul');
  list.className = 'seat-list';
  lobby.seats.forEach((seat, i) => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = i % 2 === 0 ? 'var(--us)' : 'var(--them)';
    const name = document.createElement('span');
    if (seat.kind === 'human') {
      name.textContent = seat.name + (i === 0 ? ' (host)' : '');
    } else {
      name.className = 'open';
      name.textContent = 'Open seat — a bot will fill in';
    }
    li.append(dot, name);
    list.append(li);
  });
  card.append(list);
  card.append(para(`Teams are across the table: seats 1 & 3 vs seats 2 & 4. Stick the dealer is ${lobby.options.stickTheDealer ? 'on' : 'off'}.`));
  const buttons = [];
  if (ctx.isHost) {
    buttons.push({ label: 'Copy invite link', quiet: true, onClick: copyInvite });
    buttons.push({ label: 'Start game', onClick: () => handlers.onStart && handlers.onStart() });
  }
  buttons.push({ label: 'Leave', quiet: true, onClick: () => handlers.onLeave && handlers.onLeave() });
  card.append(buttonRow(buttons));
  if (!ctx.isHost) card.append(para('Waiting for the host to start…'));
}

function resultHeadline(view) {
  const r = view.handResult;
  const makerName = displayName(view, r.maker);
  const poss = makerName === 'You' ? 'Your' : `${makerName}’s`;
  switch (r.type) {
    case 'march': return `${poss} team took all five — march!`;
    case 'aloneMarch': return `${makerName} went alone and took all five!`;
    case 'euchre': return `${poss} team got euchred!`;
    case 'aloneMade': return `${makerName} made it alone.`;
    default: return `${poss} team made it.`;
  }
}

function paintHandResult(card, view) {
  const r = view.handResult;
  const myTeam = TEAM_OF(ctx.mySeat);
  card.replaceChildren();
  card.append(h2(resultHeadline(view)));
  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = `+${r.points} ${r.scoringTeam === myTeam ? 'for Us' : 'for Them'}`;
  card.append(big);
  card.append(para(`Tricks ${r.tricks[myTeam]}–${r.tricks[1 - myTeam]} · Score ${view.scores[myTeam]}–${view.scores[1 - myTeam]}`));
  card.append(para('Next hand coming up…'));
}

function paintGameOver(card, view) {
  const myTeam = TEAM_OF(ctx.mySeat);
  const won = view.winnerTeam === myTeam;
  card.replaceChildren();
  card.append(h2(won ? '🎉 Your team wins!' : 'They took this one.'));
  const big = document.createElement('div');
  big.className = 'big';
  big.textContent = `${view.scores[myTeam]} – ${view.scores[1 - myTeam]}`;
  card.append(big);
  const partner = displayName(view, (ctx.mySeat + 2) % 4);
  const opp1 = displayName(view, (ctx.mySeat + 1) % 4);
  const opp2 = displayName(view, (ctx.mySeat + 3) % 4);
  card.append(para(`You & ${partner} vs ${opp1} & ${opp2}`));
  const buttons = [];
  if (ctx.canRematch) buttons.push({ label: 'Play again', onClick: () => handlers.onRematch && handlers.onRematch() });
  else card.append(para('Waiting for the host to start a rematch…'));
  buttons.push({ label: 'Leave table', quiet: true, onClick: () => handlers.onLeave && handlers.onLeave() });
  card.append(buttonRow(buttons));
}

// ---------- toasts & misc ----------

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3200);
}

export function copyInvite() {
  if (!ctx || !ctx.shareUrl) return;
  navigator.clipboard
    .writeText(ctx.shareUrl)
    .then(() => toast('Invite link copied — send it to your friends!'))
    .catch(() => toast(`Invite link: ${ctx.shareUrl}`));
}

export function initChrome() {
  $('#ticker').addEventListener('click', () => {
    $('#logDrawer').hidden = false;
  });
  $('#btnCloseLog').addEventListener('click', () => {
    $('#logDrawer').hidden = true;
  });
  $('#roomChip').addEventListener('click', copyInvite);
  $('#btnLeave').addEventListener('click', () => handlers.onLeave && handlers.onLeave());
}
