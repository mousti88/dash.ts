// ─── Player ───────────────────────────────────────────────────────────────────
// The top-level class that the outside world interacts with.
//
// CHAPTER 1 SCOPE:
//   Right now Player only:
//     1. Wraps the <video> element
//     2. Creates and attaches a MediaSource (but doesn't add any SourceBuffers yet)
//     3. Wires up basic video element events (play, pause, error, timeupdate)
//     4. Exposes a typed EventEmitter so external code can subscribe to player events
//
//   In later chapters we'll inject: MPDParser, MSEController, BufferManager, ABRController.
//   For now this is intentionally minimal.
//
// HOW TO USE (from main.ts):
//   const player = new Player(document.getElementById('video') as HTMLVideoElement);
//   player.on('ready', () => console.log('player ready'));
//   player.load('https://example.com/manifest.mpd');
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from '../utils/EventEmitter.js';
import { Logger } from '../utils/Logger.js';

// ── Event map ─────────────────────────────────────────────────────────────────
// Defines every event the Player can emit and the type of its payload.
// External code can listen to these via player.on('event', handler).
//
// As we build more features, we'll add more events here:
//   'quality:change', 'buffer:low', 'abr:decision', etc.
export type PlayerEventMap = {
  /** Fired once the MediaSource is open and ready to receive SourceBuffers */
  'ready': void;
  /** Fired when video playback starts */
  'playing': void;
  /** Fired when video playback is paused */
  'paused': void;
  /** Fired each time the playback position changes (~4× per second) */
  'timeupdate': { currentTime: number; duration: number };
  /** Fired when the player stalls (video pauses waiting for data) */
  'stalled': void;
  /** Fired when a fatal error occurs */
  'error': { message: string; detail?: unknown };
  /** Fired when the player is fully destroyed and cleaned up */
  'destroyed': void;
};

// ── Player state ──────────────────────────────────────────────────────────────
export type PlayerState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'error' | 'destroyed';

// ── Player ────────────────────────────────────────────────────────────────────
export class Player extends EventEmitter<PlayerEventMap> {
  private readonly video: HTMLVideoElement;
  private readonly log: Logger;

  private mediaSource: MediaSource | null = null;
  private mediaSourceUrl: string | null = null;

  private _state: PlayerState = 'idle';

  // Bound event handlers — stored so we can remove them in destroy()
  private readonly onVideoPlay: () => void;
  private readonly onVideoPause: () => void;
  private readonly onVideoTimeUpdate: () => void;
  private readonly onVideoStalled: () => void;
  private readonly onVideoError: () => void;
  private readonly onMediaSourceOpen: () => void;
  private readonly onMediaSourceEnded: () => void;
  private readonly onMediaSourceError: () => void;

  constructor(video: HTMLVideoElement) {
    super();
    this.video = video;
    this.log = new Logger('Player');

    // Pre-bind all handlers so we can cleanly remove them later.
    // (Arrow functions defined inline in addEventListener can never be removed.)
    this.onVideoPlay        = this.handleVideoPlay.bind(this);
    this.onVideoPause       = this.handleVideoPause.bind(this);
    this.onVideoTimeUpdate  = this.handleVideoTimeUpdate.bind(this);
    this.onVideoStalled     = this.handleVideoStalled.bind(this);
    this.onVideoError       = this.handleVideoError.bind(this);
    this.onMediaSourceOpen  = this.handleMediaSourceOpen.bind(this);
    this.onMediaSourceEnded = this.handleMediaSourceEnded.bind(this);
    this.onMediaSourceError = this.handleMediaSourceError.bind(this);

    this.attachVideoListeners();
    this.log.info('Player created');
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get state(): PlayerState {
    return this._state;
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  get duration(): number {
    return isFinite(this.video.duration) ? this.video.duration : 0;
  }

  /**
   * Load a DASH stream from the given MPD URL.
   *
   * CHAPTER 1: This just sets up the MediaSource. In Chapter 3 we'll parse the
   * MPD and start fetching segments here.
   */
  load(mpdUrl: string): void {
    if (this._state !== 'idle') {
      this.log.warn('load() called while not idle — ignoring. Call destroy() first.');
      return;
    }

    this.log.info(`Loading: ${mpdUrl}`);
    this.setState('loading');

    // Step 1: Create a MediaSource and attach it to the video element.
    //
    // URL.createObjectURL(mediaSource) returns a special "blob:" URL that the
    // browser uses as a handle to the MediaSource. Setting video.src to this
    // URL tells the browser "I'll feed you data through this MediaSource object".
    this.mediaSource = new MediaSource();
    this.mediaSource.addEventListener('sourceopen',  this.onMediaSourceOpen);
    this.mediaSource.addEventListener('sourceended', this.onMediaSourceEnded);
    this.mediaSource.addEventListener('sourceerror', this.onMediaSourceError);

    this.mediaSourceUrl = URL.createObjectURL(this.mediaSource);
    this.video.src = this.mediaSourceUrl;

    this.log.info('MediaSource created and attached to video element');
    this.log.debug('MediaSource readyState:', this.mediaSource.readyState);
    // readyState is "closed" here. It becomes "open" once the browser fires
    // the "sourceopen" event — that's when we can add SourceBuffers.
  }

  play(): void {
    this.video.play().catch((err: unknown) => {
      this.log.warn('play() was blocked by browser', err);
    });
  }

  pause(): void {
    this.video.pause();
  }

  seek(time: number): void {
    if (time < 0 || time > this.duration) {
      this.log.warn(`seek(${time}) is out of range [0, ${this.duration}]`);
      return;
    }
    this.video.currentTime = time;
  }

  /**
   * Tear down the player: remove all event listeners, revoke the blob URL,
   * close the MediaSource, and emit 'destroyed'.
   *
   * Always call this before removing the player from the DOM or creating a new one.
   */
  destroy(): void {
    if (this._state === 'destroyed') return;

    this.log.info('Destroying player');

    // Remove video element listeners
    this.detachVideoListeners();

    // Remove MediaSource listeners and close it
    if (this.mediaSource) {
      this.mediaSource.removeEventListener('sourceopen',  this.onMediaSourceOpen);
      this.mediaSource.removeEventListener('sourceended', this.onMediaSourceEnded);
      this.mediaSource.removeEventListener('sourceerror', this.onMediaSourceError);

      if (this.mediaSource.readyState === 'open') {
        try { this.mediaSource.endOfStream(); } catch (_) { /* ignore */ }
      }
      this.mediaSource = null;
    }

    // Revoke the blob URL to free memory
    if (this.mediaSourceUrl) {
      URL.revokeObjectURL(this.mediaSourceUrl);
      this.mediaSourceUrl = null;
    }

    // Clear the video src
    this.video.removeAttribute('src');
    this.video.load(); // Flushes the media pipeline

    this.setState('destroyed');
    this.emit('destroyed');
    this.removeAllListeners();
  }

  // ── Private: state ──────────────────────────────────────────────────────────

  private setState(next: PlayerState): void {
    const prev = this._state;
    this._state = next;
    this.log.debug(`State: ${prev} → ${next}`);
  }

  // ── Private: video element event handlers ───────────────────────────────────

  private attachVideoListeners(): void {
    this.video.addEventListener('play',       this.onVideoPlay);
    this.video.addEventListener('pause',      this.onVideoPause);
    this.video.addEventListener('timeupdate', this.onVideoTimeUpdate);
    this.video.addEventListener('stalled',    this.onVideoStalled);
    this.video.addEventListener('error',      this.onVideoError);
  }

  private detachVideoListeners(): void {
    this.video.removeEventListener('play',       this.onVideoPlay);
    this.video.removeEventListener('pause',      this.onVideoPause);
    this.video.removeEventListener('timeupdate', this.onVideoTimeUpdate);
    this.video.removeEventListener('stalled',    this.onVideoStalled);
    this.video.removeEventListener('error',      this.onVideoError);
  }

  private handleVideoPlay(): void {
    this.log.info('▶ Playing');
    this.setState('playing');
    this.emit('playing');
  }

  private handleVideoPause(): void {
    this.log.info('⏸ Paused');
    if (this._state !== 'destroyed') this.setState('paused');
    this.emit('paused');
  }

  private handleVideoTimeUpdate(): void {
    this.emit('timeupdate', {
      currentTime: this.video.currentTime,
      duration: this.duration,
    });
  }

  private handleVideoStalled(): void {
    this.log.warn('Video stalled — waiting for data');
    this.emit('stalled');
  }

  private handleVideoError(): void {
    const err = this.video.error;
    const message = err ? `MediaError code ${err.code}: ${err.message}` : 'Unknown video error';
    this.log.error(message);
    this.setState('error');
    this.emit('error', { message, detail: err });
  }

  // ── Private: MediaSource event handlers ─────────────────────────────────────

  private handleMediaSourceOpen(): void {
    this.log.info('MediaSource is open ✓');
    this.log.debug('MediaSource readyState:', this.mediaSource?.readyState);
    // In Chapter 3 we'll call MSEController.init() here to add SourceBuffers.
    // For now we just signal that the player is ready.
    this.setState('ready');
    this.emit('ready');
  }

  private handleMediaSourceEnded(): void {
    this.log.info('MediaSource ended (all segments appended)');
  }

  private handleMediaSourceError(): void {
    this.log.error('MediaSource error');
    this.setState('error');
    this.emit('error', { message: 'MediaSource error' });
  }
}
