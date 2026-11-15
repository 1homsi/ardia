import { TRAY_BACK_TRAVEL, trayBack, type TrayBackHandlers } from "../../platform/back";

export const trayBackTravel = TRAY_BACK_TRAVEL;

export function followTrayBack(handlers: TrayBackHandlers): () => void {
  trayBack.setEnabled(true);
  const subscription = trayBack.listen(handlers);
  return () => {
    subscription.remove();
    trayBack.setEnabled(false);
  };
}
