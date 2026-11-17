export type LinuxControlsState = { pageFullScreen: boolean; hidden: boolean; utility: boolean; windowMenu: boolean };

export const linuxControlsBehaviour = ({ pageFullScreen, hidden, utility, windowMenu }: LinuxControlsState) => ({
  rendered: !pageFullScreen,
  inert: hidden,
  windowMenuOnRightClick: windowMenu && !utility,
});

const CAPTION_BUTTON = '[role="button"]';

export const pressKeepsFocusWhereItWas = (event: { button: number; target: unknown }): boolean =>
  event.button === 0 && !!event.target && typeof event.target === "object" && "closest" in event.target && !!(event.target as Element).closest(CAPTION_BUTTON);
