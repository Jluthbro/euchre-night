// App bootstrap: home screen, session lifecycle (solo / host / join),
// and the plumbing between game drivers and the UI.

import * as ui from './ui.js';
import { GameHost, pickBotName } from './host.js';
import { NetHost, NetClient, peerAvailable, normalizeCode } from './net.js';

const $ = (sel) => document.querySelector(sel);

let session = null; // { kind, destroy() }

function savedName() {
  try { return localStorage.getItem('euchre-name') || ''; } catch { return ''; }
}

function getName() {
  const raw = $('#nameInput').value.replace(/\s+/g, ' ').trim().slice(0, 16);
  const name = raw || 'Player';
  try { localStorage.setItem('euchre-name', name); } catch { /* private mode */ }
  return name;
}

function getOptions() {
  return { stickTheDealer: $('#stickToggle').checked };
}

function endSession() {
  if (session) {
    session.destroy();
    session = null;
  }
}

function leaveToHome() {
  endSession();
  ui.clearNotice();
  ui.showScreen('home');
}

function shareUrlFor(code) {
  return `${location.origin}${location.pathname}?join=${code}`;
}

// ---------- solo ----------

function startSolo() {
  endSession();
  const name = getName();
  const seats = [{ name, kind: 'human' }];
  while (seats.length < 4) {
    seats.push({ name: pickBotName(seats.map((s) => s.name)), kind: 'bot' });
  }
  const game = new GameHost({ seats, options: getOptions() });
  const context = { mode: 'solo', mySeat: 0, canRematch: true };
  game.onChange(() => ui.renderTable(game.viewFor(0), context));
  ui.setHandlers({
    onAction: (a) => {
      const r = game.submit(0, a);
      if (!r.ok) ui.toast(r.error);
    },
    onRematch: () => game.rematch(),
    onLeave: leaveToHome,
  });
  session = { kind: 'solo', destroy: () => game.destroy() };
  ui.showScreen('table');
  game.start();
}

// ---------- host ----------

function startHost() {
  if (!requirePeer()) return;
  endSession();
  const name = getName();
  let net = null;
  const context = { mode: 'host', mySeat: 0, canRematch: true, isHost: true };
  net = new NetHost({
    hostName: name,
    options: getOptions(),
    callbacks: {
      onCode: (code) => {
        context.roomCode = code;
        context.shareUrl = shareUrlFor(code);
      },
      onLobby: (lobby) => ui.renderLobby(lobby, context),
      onState: (view) => ui.renderTable(view, context),
      onError: (msg) => ui.toast(msg),
    },
  });
  ui.setHandlers({
    onAction: (a) => net.submitLocal(a),
    onStart: () => net.startGame(),
    onRematch: () => net.rematch(),
    onLeave: leaveToHome,
  });
  session = { kind: 'host', destroy: () => net.close() };
  ui.showScreen('table');
  ui.showNotice('Opening your table…', 'Getting a room code from the matchmaking server.');
}

// ---------- join ----------

function startClient(rawCode) {
  if (!requirePeer()) return;
  const code = normalizeCode(rawCode);
  if (code.length < 4) {
    ui.toast('Enter the room code your host shared.');
    return;
  }
  endSession();
  const name = getName();
  const context = { mode: 'client', mySeat: 0, canRematch: false, roomCode: code, shareUrl: shareUrlFor(code) };
  const client = new NetClient({
    code,
    name,
    callbacks: {
      onWelcome: (seat) => {
        context.mySeat = seat;
        ui.clearNotice();
      },
      onLobby: (lobby) => ui.renderLobby(lobby, context),
      onView: (view) => {
        context.mySeat = view.you;
        ui.renderTable(view, context);
      },
      onError: (msg) => {
        ui.showNotice('Couldn’t join the table', msg, [
          { label: 'Back', onClick: leaveToHome },
        ]);
      },
      onClosed: (gotIn) => {
        if (!session || session.kind !== 'client') return;
        ui.showNotice(
          'Disconnected',
          gotIn
            ? 'You lost the host. If the table is still going, rejoin with the same name and a bot will hand your cards back.'
            : 'Couldn’t reach that table. Double-check the code with your host.',
          [
            { label: 'Rejoin', onClick: () => startClient(code) },
            { label: 'Back to menu', quiet: true, onClick: leaveToHome },
          ]
        );
      },
    },
  });
  ui.setHandlers({
    onAction: (a) => client.send(a),
    onLeave: leaveToHome,
  });
  session = { kind: 'client', destroy: () => client.close() };
  ui.showScreen('table');
  ui.showNotice('Joining…', `Looking for table ${code}.`);
}

function requirePeer() {
  if (peerAvailable()) return true;
  ui.toast('Online play needs the PeerJS library, which failed to load. Solo play still works.');
  return false;
}

// ---------- boot ----------

function boot() {
  ui.initChrome();
  $('#nameInput').value = savedName();
  try {
    const stick = localStorage.getItem('euchre-stick');
    if (stick != null) $('#stickToggle').checked = stick === '1';
  } catch { /* ignore */ }
  $('#stickToggle').addEventListener('change', () => {
    try { localStorage.setItem('euchre-stick', $('#stickToggle').checked ? '1' : '0'); } catch { /* ignore */ }
  });

  $('#btnSolo').addEventListener('click', startSolo);
  $('#btnHost').addEventListener('click', startHost);
  $('#btnJoin').addEventListener('click', () => startClient($('#codeInput').value));
  $('#codeInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startClient($('#codeInput').value);
  });
  $('#nameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('#codeInput').value) startClient($('#codeInput').value);
  });

  const joinCode = new URLSearchParams(location.search).get('join');
  if (joinCode) {
    $('#codeInput').value = normalizeCode(joinCode);
    if (savedName()) {
      startClient(joinCode);
    } else {
      $('#nameInput').focus();
      ui.toast('Enter your name, then hit Join.');
    }
  }

  // Auto-join above may already be on the table screen with a notice up.
  if (!session) ui.showScreen('home');
}

boot();
