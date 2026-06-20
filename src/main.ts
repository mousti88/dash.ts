// ─── main.ts ─────────────────────────────────────────────────────────────────
// Application entry point.
//
// This file bootstraps the Player onto the <video> element in index.html.
// It also wires up the minimal debug UI (time display, state badge).
//
// CHAPTER 1 scope: load() doesn't stream anything yet — it just attaches the
// MediaSource and waits. You should see "MediaSource is open ✓" in the console.
// ─────────────────────────────────────────────────────────────────────────────

import { Player } from './player/Player.js';
import { Logger } from './utils/Logger.js';

const log = new Logger('main');

// ── Grab DOM elements ─────────────────────────────────────────────────────────
const video = document.getElementById('video') as HTMLVideoElement | null;
const stateEl = document.getElementById('state') as HTMLElement | null;
const timeEl = document.getElementById('time') as HTMLElement | null;
const loadBtn = document.getElementById('btn-load') as HTMLButtonElement | null;
const playBtn = document.getElementById('btn-play') as HTMLButtonElement | null;
const destroyBtn = document.getElementById('btn-destroy') as HTMLButtonElement | null;

if (!video) {
  throw new Error('No #video element found in index.html');
}

// ── Create player ─────────────────────────────────────────────────────────────
const player = new Player(video);

// ── Listen to player events ───────────────────────────────────────────────────
player.on('ready', () => {
  log.info('🟢 Player is ready');
  setStateLabel('ready');
});

player.on('playing', () => setStateLabel('playing ▶'));
player.on('paused',  () => setStateLabel('paused ⏸'));
player.on('stalled', () => setStateLabel('stalled ⏳'));
player.on('error',   ({ message }) => {
  log.error('Player error:', message);
  setStateLabel('error ✗');
});

player.on('timeupdate', ({ currentTime, duration }) => {
  if (timeEl) {
    timeEl.textContent = `${fmt(currentTime)} / ${fmt(duration)}`;
  }
});

player.on('destroyed', () => {
  setStateLabel('destroyed');
  log.info('Player destroyed');
});

// ── Button wiring ─────────────────────────────────────────────────────────────
//
// NOTE: There's no real DASH stream to load yet (that's Chapter 3).
//       For now, load() just attaches the MediaSource so you can inspect it
//       in Chrome DevTools → Application → Media.
//
loadBtn?.addEventListener('click', () => {
  // Replace this with a real DASH MPD URL in Chapter 3.
  // For now we use a placeholder — the MediaSource will open but stay empty.
  player.load('https://dash.akamaized.net/akamai/bbb_30fps/bbb_30fps.mpd');
});

playBtn?.addEventListener('click', () => {
  if (player.state === 'playing') {
    player.pause();
  } else {
    player.play();
  }
});

destroyBtn?.addEventListener('click', () => {
  player.destroy();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setStateLabel(text: string): void {
  if (stateEl) stateEl.textContent = text;
}

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

log.info('dash.ts initialised — open the console to see player events');
