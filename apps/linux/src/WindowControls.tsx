import { memo } from "react";
import { controlsShown, WindowControls as SharedWindowControls, type WindowControlsProps } from "../../browser/src/components/window/WindowControls";
import { useFullscreenTab } from "../../browser/src/state/tabs/pageState";
import { reportHostError } from "./host";
import { isLinuxUtility } from "./session";
import { linuxWindowMenu } from "./linuxWindowMenu";

export { controlsShown, type WindowControlsProps };

export const WindowControls = memo(function WindowControls(props: WindowControlsProps) {
  const pageFullScreen = !!useFullscreenTab(props.windowId);
  if (pageFullScreen) return null;
  return (
    <div
      style={{ display: "contents" }}
      inert={props.hidden || undefined}
      onContextMenu={(event) => {
        if (!linuxWindowMenu || isLinuxUtility(props.windowId)) return;
        event.preventDefault();
        void linuxWindowMenu.open(props.windowId).catch(reportHostError);
      }}
    >
      <SharedWindowControls {...props} />
    </div>
  );
});
