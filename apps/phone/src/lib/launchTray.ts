export const LAUNCH_TRAY_DEFERRED_FRAMES = 2;

export const launchTrayFrames = (os: string, labBuild: boolean, defers: boolean): number => (os === "android" && labBuild && defers ? LAUNCH_TRAY_DEFERRED_FRAMES : 0);

export const tabFaceDecodesAtDrawnSize = (os: string, labBuild: boolean, resizes: boolean): boolean => os === "android" && labBuild && resizes;
