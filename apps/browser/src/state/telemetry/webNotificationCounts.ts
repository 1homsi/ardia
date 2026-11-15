let fromShim = 0;

export const noteWebNotificationFromShim = () => void fromShim++;

export function takeWebNotificationCounts() {
  const taken = { web_notifications_from_shim: fromShim };
  fromShim = 0;
  return taken;
}
