// ─── EventEmitter ────────────────────────────────────────────────────────────
// A fully typed publish/subscribe event bus.
//
// WHY THIS EXISTS:
//   In a streaming player, many things happen asynchronously: network events,
//   buffer changes, quality switches, stalls. Without a central event bus, every
//   module would need direct references to every other module — a mess of circular
//   imports and tight coupling.
//
//   With EventEmitter, a module just says "something happened" (emit) and any
//   number of listeners can react independently (on/off).
//
// USAGE:
//   // Define your event map (see PlayerEventMap in Player.ts for a real example)
//   type MyEvents = {
//     'ready': void;
//     'error': Error;
//     'bandwidth': { bps: number };
//   };
//
//   const emitter = new EventEmitter<MyEvents>();
//   emitter.on('bandwidth', ({ bps }) => console.log('Speed:', bps));
//   emitter.emit('bandwidth', { bps: 5_000_000 });
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A map from event name → the payload type for that event.
 * `void` means the event carries no data.
 */
export type EventMap = Record<string, unknown>;

/** A listener function for event E with payload P. */
type Listener<P> = P extends void ? () => void : (payload: P) => void;

export class EventEmitter<Events extends EventMap> {
  // Each event name maps to a set of listener functions.
  // We use `any` internally so the typed public API stays clean.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly listeners = new Map<keyof Events, Set<(...args: any[]) => void>>();

  /**
   * Register a listener for `event`.
   * Returns `this` so you can chain: emitter.on('a', ...).on('b', ...)
   */
  on<E extends keyof Events>(event: E, listener: Listener<Events[E]>): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Remove a previously registered listener.
   * Always call this when a module is destroyed to avoid memory leaks.
   */
  off<E extends keyof Events>(event: E, listener: Listener<Events[E]>): this {
    this.listeners.get(event)?.delete(listener as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Register a listener that fires only once, then removes itself.
   */
  once<E extends keyof Events>(event: E, listener: Listener<Events[E]>): this {
    const wrapper = (...args: unknown[]): void => {
      (listener as (...a: unknown[]) => void)(...args);
      this.off(event, wrapper as Listener<Events[E]>);
    };
    return this.on(event, wrapper as Listener<Events[E]>);
  }

  /**
   * Fire `event` with the given `payload`.
   * All registered listeners are called synchronously.
   */
  emit<E extends keyof Events>(
    ...args: Events[E] extends void ? [event: E] : [event: E, payload: Events[E]]
  ): void {
    const [event, payload] = args as [E, Events[E]];
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of set) {
      fn(payload);
    }
  }

  /** Remove all listeners for all events. Call this on player destroy. */
  removeAllListeners(): void {
    this.listeners.clear();
  }
}
