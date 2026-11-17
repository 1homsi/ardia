const PAD = 5;
const MIN_CUT_NAME = 52;
const ICON_WIDTH = 32;
const MENU_WIDTH = 32;
const GAP = 2;

function indicatorWithMenu({ room, textWidth, named }: { room: number; textWidth: number | undefined; named: boolean }) {
  const nameRoom = room - MENU_WIDTH - GAP;
  const shown = named && nameRoom >= ICON_WIDTH;
  const textRoom = nameRoom - 2 * PAD;
  const showName = shown && !!textWidth && (textWidth <= textRoom || textRoom >= MIN_CUT_NAME);
  const nameWidth = !shown ? 0 : showName ? Math.min(nameRoom, textWidth + 2 * PAD) : ICON_WIDTH;
  return { shown, showName, nameWidth, width: Math.max(0, Math.min(room, nameWidth + (shown ? GAP : 0) + MENU_WIDTH)) };
}

export function headerIndicatorLayout({ room, textWidth, named, menuInHeader }: { room: number; textWidth: number | undefined; named: boolean; menuInHeader: boolean }) {
  if (menuInHeader) return { ...indicatorWithMenu({ room, textWidth, named }), menuInHeader };
  const layout = indicatorWithMenu({ room: room + MENU_WIDTH + GAP, textWidth, named });
  return { ...layout, menuInHeader, width: layout.shown ? layout.nameWidth : 0 };
}
