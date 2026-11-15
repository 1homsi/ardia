export type TypeAheadBar = { read(): { text: string; start: number; end: number }; type(text: string): void };

const TYPE_AHEAD_MS = 3000;

let focused: TypeAheadBar | null = null;
let armed: { windowId: string; from: TypeAheadBar; before: string; at: number } | null = null;

export function barFocused(bar: TypeAheadBar) {
  focused = bar;
}

export function barBlurred(bar: TypeAheadBar) {
  if (focused === bar) focused = null;
}

export function armTypeAhead(windowId: string, now = Date.now()) {
  armed = focused ? { windowId, from: focused, before: focused.read().text, at: now } : null;
}

export function takeTypeAhead(windowId: string, into: TypeAheadBar, now = Date.now()): string | null {
  const pending = armed;
  armed = null;
  if (!pending || pending.from === into || pending.windowId !== windowId || now - pending.at > TYPE_AHEAD_MS) return null;
  const text = pending.from.read().text;
  if (text.length <= pending.before.length || !text.startsWith(pending.before)) return null;
  pending.from.type(pending.before);
  const extra = text.slice(pending.before.length);
  const field = into.read();
  const replacing = field.start === 0 && field.end === field.text.length;
  return replacing ? extra : field.text.slice(0, field.start) + extra + field.text.slice(field.end);
}
