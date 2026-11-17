import { queueLog, type ConsentToken } from "./client";
import { knownErrorCode, knownErrorMessage } from "./knownErrors";
import { errorType, scrubText } from "./sanitize";

const MAX_DISTINCT = 40;
const seen = new Set<string>();

export { errorFor, logConsent, warnFor } from "./consoleConsent";

export function recordLog(level: "warn" | "error", args: unknown[], consent: ConsentToken | null) {
  const first = args[0];
  if (typeof first !== "string") return;
  const message = scrubText(first, 160);
  if (!message) return;
  const error = args.slice(1).find((a) => a instanceof Error);
  const type = error ? errorType(error) : "none";
  const reason = error ? knownErrorMessage(error) : "";
  const code = error ? knownErrorCode(error) : null;
  const key = `${message}\n${type}\n${reason}\n${code ?? ""}`;
  if (seen.has(key) || seen.size >= MAX_DISTINCT) return;
  seen.add(key);
  const attributes: Record<string, string> = { error_type: type };
  if (reason) attributes.error_message = reason;
  if (code) attributes.error_code = code;
  queueLog(level, message, attributes, consent);
}
