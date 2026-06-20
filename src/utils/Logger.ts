// ─── Logger ───────────────────────────────────────────────────────────────────
// A namespaced, colour-coded console logger.
//
// WHY THIS EXISTS:
//   A streaming player produces a lot of log output from many different modules.
//   Using bare console.log everywhere makes it impossible to tell what came from
//   where. This logger:
//     1. Tags every message with the module name (e.g. [Player], [ABR], [Buffer])
//     2. Colour-codes the tag in Chrome DevTools for instant visual scanning
//     3. Can be globally silenced (e.g. in production) by setting Logger.enabled
//
// USAGE:
//   const log = new Logger('ABRController');
//   log.info('Switching to 720p');          // [ABRController] Switching to 720p
//   log.warn('Buffer critically low');
//   log.error('Failed to fetch segment', err);
//   log.debug('Bandwidth sample', { bps });  // Only shown when Logger.debug = true
// ─────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Colour palette for module tags (cycles through these)
const COLOURS = [
  '#4fc3f7', // light blue
  '#81c784', // green
  '#ffb74d', // orange
  '#ce93d8', // purple
  '#80deea', // cyan
  '#f48fb1', // pink
  '#a5d6a7', // mint
  '#ffcc80', // yellow
];

let colourIndex = 0;
const moduleColours = new Map<string, string>();

function getColour(name: string): string {
  if (!moduleColours.has(name)) {
    moduleColours.set(name, COLOURS[colourIndex % COLOURS.length] ?? '#ffffff');
    colourIndex++;
  }
  return moduleColours.get(name)!;
}

export class Logger {
  /** Set to false to silence all loggers globally */
  static enabled = true;
  /** Set to true to show debug-level messages */
  static debugEnabled = true;

  private readonly name: string;
  private readonly colour: string;

  constructor(name: string) {
    this.name = name;
    this.colour = getColour(name);
  }

  private format(level: LogLevel): string[] {
    const tag = `%c[${this.name}]%c`;
    const tagStyle = `color: ${this.colour}; font-weight: bold;`;
    const resetStyle = 'color: inherit; font-weight: normal;';
    const levelStyle = level === 'error'
      ? 'color: #ef5350;'
      : level === 'warn'
        ? 'color: #ffa726;'
        : '';

    return [`${tag}%c `, tagStyle, resetStyle, levelStyle];
  }

  debug(message: string, ...args: unknown[]): void {
    if (!Logger.enabled || !Logger.debugEnabled) return;
    console.debug(...this.format('debug'), message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    if (!Logger.enabled) return;
    console.info(...this.format('info'), message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    if (!Logger.enabled) return;
    console.warn(...this.format('warn'), message, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    // Errors are always logged even if Logger.enabled is false
    console.error(...this.format('error'), message, ...args);
  }
}
