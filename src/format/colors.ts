type Paint = (text: string) => string;

export interface Palette {
  green: Paint;
  red: Paint;
  yellow: Paint;
  cyan: Paint;
  dim: Paint;
  bold: Paint;
}

const ansi = (open: number, close: number): Paint => (text) => `\u001b[${open}m${text}\u001b[${close}m`;
const plain: Paint = (text) => text;

export function palette(enabled: boolean): Palette {
  if (!enabled) return { green: plain, red: plain, yellow: plain, cyan: plain, dim: plain, bold: plain };
  return {
    green: ansi(32, 39),
    red: ansi(31, 39),
    yellow: ansi(33, 39),
    cyan: ansi(36, 39),
    dim: ansi(2, 22),
    bold: ansi(1, 22),
  };
}

/** Honors NO_COLOR / FORCE_COLOR, otherwise colors only interactive terminals. */
export function colorEnabled(stream: { isTTY?: boolean } = process.stdout): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(stream.isTTY);
}
