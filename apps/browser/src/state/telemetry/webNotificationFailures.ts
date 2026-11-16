import type { NotificationPostResult } from "../../platform/notifications";
import { capture } from "./client";
import { errorType } from "./sanitize";

export const WEB_NOTIFICATION_FAILED = "web_notification_failed";

export type SentWebNotification = {
  titleLength: number;
  bodyLength: number;
  iconRequested: boolean;
  iconSent: boolean;
};

export function webNotificationFailureProperties(sent: SentWebNotification, result: NotificationPostResult | null | undefined, thrown?: { error: unknown }) {
  return {
    title_length: sent.titleLength,
    body_length: sent.bodyLength,
    icon_requested: sent.iconRequested,
    icon_sent: sent.iconSent,
    icon_status: result?.icon ?? "unknown",
    via_shim: true,
    threw: !!thrown,
    ...(thrown ? { error_type: errorType(thrown.error) } : {}),
    ...(typeof result?.errorCode === "number" ? { error_code: result.errorCode } : {}),
    ...(result?.errorDomain ? { error_domain: result.errorDomain } : {}),
    ...(typeof result?.iconErrorCode === "number" ? { icon_error_code: result.iconErrorCode } : {}),
  };
}

// The Mac answers with a NotificationPostResult. The Windows and Linux hosts still answer with the id as text, or null, and
// carry no error to record, so only a result object that has no id is a refused post.
export function recordWebNotificationPost(posted: Promise<NotificationPostResult | string | null | undefined>, sent: SentWebNotification): Promise<void> {
  return posted.then(
    (result) => {
      if (result && typeof result === "object" && !result.id) capture(WEB_NOTIFICATION_FAILED, webNotificationFailureProperties(sent, result));
    },
    (error: unknown) => {
      capture(WEB_NOTIFICATION_FAILED, webNotificationFailureProperties(sent, null, { error }));
      throw error;
    },
  );
}
