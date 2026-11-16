import assert from "node:assert/strict";
import { test } from "node:test";
const { noteEngineNotificationResponse, noteWebNotificationClicked, takeNotificationRequestCounts } = await import("./notificationRequestCounts.ts");

test("notification clicks and service worker notification responses are counted and reset when taken", () => {
  takeNotificationRequestCounts();
  noteWebNotificationClicked();
  noteWebNotificationClicked();
  noteEngineNotificationResponse();
  assert.deepEqual(takeNotificationRequestCounts(), { notification_requests_auto_denied: 0, web_notification_clicks: 2, worker_notification_responses: 1 });
  assert.deepEqual(takeNotificationRequestCounts(), { notification_requests_auto_denied: 0, web_notification_clicks: 0, worker_notification_responses: 0 });
});
