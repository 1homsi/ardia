let autoDenied = 0;
let webClicks = 0;
let engineResponses = 0;

export function noteNotificationRequestAutoDenied() {
  autoDenied++;
}

export function noteWebNotificationClicked() {
  webClicks++;
}

export function noteEngineNotificationResponse() {
  engineResponses++;
}

export function takeNotificationRequestCounts() {
  const taken = { notification_requests_auto_denied: autoDenied, web_notification_clicks: webClicks, worker_notification_responses: engineResponses };
  autoDenied = webClicks = engineResponses = 0;
  return taken;
}
