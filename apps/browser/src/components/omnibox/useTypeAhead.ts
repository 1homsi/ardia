import { useEffect, useRef, useState } from "react";
import { barBlurred, barFocused, takeTypeAhead, type TypeAheadBar } from "../../state/omnibox/typeAhead";

const HELD_MS = 600;

export function useTypeAhead(windowId: string, read: TypeAheadBar["read"], type: TypeAheadBar["type"]) {
  const latest = useRef({ windowId, read, type });
  latest.current = { windowId, read, type };
  const [handlers] = useState(() => {
    let held: { text: string; until: number } | null = null;
    const bar: TypeAheadBar = { read: () => latest.current.read(), type: (text) => latest.current.type(text) };
    return {
      bar,
      focused() {
        const text = takeTypeAhead(latest.current.windowId, bar);
        barFocused(bar);
        if (text === null) return;
        bar.type(text);
        held = { text, until: Date.now() + HELD_MS };
      },
      blurred() {
        held = null;
        barBlurred(bar);
      },
      text(raw: string) {
        if (!held) return raw;
        if (Date.now() > held.until || raw.startsWith(held.text)) {
          held = null;
          return raw;
        }
        return held.text + raw;
      },
    };
  });
  useEffect(() => () => barBlurred(handlers.bar), [handlers]);
  return handlers;
}
