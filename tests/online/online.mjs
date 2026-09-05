// Real online-play test: two browser contexts, a local PeerServer for
// signaling, actual WebRTC data channels between host and friend.
// Not part of `npm test` (needs a browser). To run:
//   npm i --no-save playwright-core peer
//   npx peerjs --host 127.0.0.1 --port 9000 --path / &
//   python3 -m http.server 8081 &
//   CHROME_PATH=/path/to/chrome node tests/online/online.mjs
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://127.0.0.1:8081/';
const PEER = { host: '127.0.0.1', port: 9000, path: '/', secure: false };
const DEAD_PEER = { host: '127.0.0.1', port: 9599, path: '/', secure: false };
const SHOTS = process.env.SHOTS_DIR || '.';
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});

async function newPage(label, peerCfg, watchErrors = true) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
  await ctx.addInitScript((cfg) => { window.EUCHRE_PEER_SERVER = cfg; }, peerCfg);
  const page = await ctx.newPage();
  if (watchErrors) {
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
  }
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return page;
}

const overlayText = (page) => page.evaluate(() => {
  const o = document.querySelector('#overlay');
  return o && !o.hidden ? o.textContent : '';
});

async function waitOverlay(page, re, timeout = 20000) {
  await page.waitForFunction((src) => {
    const o = document.querySelector('#overlay');
    return o && !o.hidden && new RegExp(src).test(o.textContent);
  }, re.source, { timeout });
}

// ---- 1. Host opens a table and gets a code ----
const host = await newPage('host', PEER);
await host.fill('#nameInput', 'Justin');
await host.click('#btnHost');
await waitOverlay(host, /Friends join with this code/);
const code = await host.$eval('#overlayCard .code', (el) => el.textContent.trim());
assert.match(code, /^[A-Z2-9]{5}$/, 'room code format');
console.log('room code:', code);
await host.screenshot({ path: `${SHOTS}/online-1-host-lobby.png` });

// ---- 2. A friend joins with the code ----
const sam = await newPage('sam', PEER);
await sam.fill('#nameInput', 'Sam');
await sam.fill('#codeInput', code.toLowerCase());
await sam.click('#btnJoin');
await waitOverlay(sam, /You.re in/);
await waitOverlay(host, /Sam/);
console.log('friend joined; host lobby lists Sam');
await sam.screenshot({ path: `${SHOTS}/online-2-friend-lobby.png` });

// ---- 3. Host starts; both see cards ----
await host.click('#overlayCard button:has-text("Start game")');
await host.waitForSelector('#handArea .card', { timeout: 10000 });
await sam.waitForSelector('#handArea .card', { timeout: 10000 });
const samSeat = await sam.evaluate(() => document.querySelector('#seat-0 .pname')?.textContent);
console.log('game started; friend bottom plate:', samSeat);

// ---- 4. Drive turns on both pages; state must stay in sync ----
// A view update from the host can re-render the DOM between finding an
// element and clicking it; a swallowed click just means "try again".
async function tryClick(locator) {
  try {
    await locator.first().click({ timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}
async function act(page) {
  const btns = await page.$$eval('#actionBar .btn', (els) => els.map((b) => b.textContent.trim()));
  if (btns.length) {
    if (btns.includes('Pass') && Math.random() < 0.6) return tryClick(page.locator('#actionBar .btn', { hasText: 'Pass' }));
    if (btns.some((t) => /^[♠♥♦♣]$/.test(t))) return tryClick(page.locator('#actionBar .btn.suit'));
    const label = btns.find((t) => /Order|Pick/.test(t)) || btns[0];
    return tryClick(page.locator('#actionBar .btn', { hasText: label }));
  }
  if (await page.$('#handArea .card.playable')) return tryClick(page.locator('#handArea .card.playable'));
  return false;
}
let actions = 0;
const deadline = Date.now() + 90000;
while (actions < 14 && Date.now() < deadline) {
  const a = await act(host);
  const b = await act(sam);
  if (a || b) { actions++; await sleep(200); } else await sleep(250);
}
assert.ok(actions >= 10, `expected ≥10 human actions across both browsers, got ${actions}`);
// Tickers converge once bots settle.
let synced = false;
for (let i = 0; i < 20 && !synced; i++) {
  const [th, ts] = await Promise.all([host.$eval('#ticker', (e) => e.textContent), sam.$eval('#ticker', (e) => e.textContent)]);
  synced = th === ts && th.length > 0;
  if (!synced) await sleep(300);
}
assert.ok(synced, 'host and friend log lines never converged');
console.log(`played ${actions} human actions across two browsers, state in sync`);
await sam.screenshot({ path: `${SHOTS}/online-3-friend-table.png` });

// ---- 5. Friend drops: a bot takes the seat on the host's table ----
await sam.context().close();
const dropAt = Date.now();
await host.waitForFunction(() => /🤖/.test(document.querySelector('#seat-1')?.textContent || ''), null, { timeout: 25000 });
console.log(`friend disconnected; bot took over seat after ${((Date.now() - dropAt) / 1000).toFixed(1)}s`);

// ---- 6. Rejoin by name reclaims the seat ----
const sam2 = await newPage('sam2', PEER);
await sam2.fill('#nameInput', 'Sam');
await sam2.fill('#codeInput', code);
await sam2.click('#btnJoin');
await sam2.waitForSelector('#handArea .card', { timeout: 15000 });
await host.waitForFunction(() => /Sam/.test(document.querySelector('#seat-1')?.textContent || '') && !/🤖/.test(document.querySelector('#seat-1')?.textContent || ''), null, { timeout: 10000 });
console.log('friend rejoined and got the seat back');

// ---- 7. Wrong code: friendly error, not a hang ----
const lost = await newPage('lost', PEER, false);
await lost.fill('#nameInput', 'Pat');
await lost.fill('#codeInput', 'ZZZZZ');
await lost.click('#btnJoin');
await waitOverlay(lost, /Couldn.t join the table/, 25000);
const lostBtns = await lost.$$eval('#overlayCard .btn', (els) => els.map((b) => b.textContent.trim()));
assert.ok(lostBtns.includes('Try again'), 'wrong-code notice offers retry');
console.log('wrong code shows a retry-able error');

// ---- 8. Signaling server down: host gets an error with retry, not a hang ----
const lonely = await newPage('lonely', DEAD_PEER, false);
await lonely.fill('#nameInput', 'Nobody');
await lonely.click('#btnHost');
await waitOverlay(lonely, /Couldn.t open a table/, 25000);
console.log('dead signaling server surfaces an error with retry');

console.log(JSON.stringify({ actions, errors }, null, 2));
await browser.close();
if (errors.length) { console.error('ONLINE TEST FAILED'); process.exit(1); }
console.log('ONLINE TEST OK');
