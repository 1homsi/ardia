import { selfChecks } from "../app/selfCheck";
import { useBrowser } from "../browser/store";
import { webviews } from "../../platform/webviews";
import { httpPagesPort } from "../../platform/launchConfig";
import { lastTabClosesWindow } from "../../platform/tabs";

const STORAGE_KEY = "ardia-profile-check";
const COOKIE = "ardiaProfileCheck";
const WAIT_MS = 20000;
const POLL_MS = 100;

type WebViewHandle = NonNullable<ReturnType<typeof webviews.get>>;
type Seen = { href: string; storage: string | null; cookie: string | null };

const S = () => useBrowser.getState();
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const parsed = (reply: unknown): unknown => {
  if (typeof reply !== "string") return reply;
  try {
    return JSON.parse(reply) as unknown;
  } catch {
    return null;
  }
};

const readCode = `const cookie = document.cookie.split("; ").find((each) => each.startsWith("${COOKIE}="));
post("result", JSON.stringify({ href: location.href, storage: localStorage.getItem("${STORAGE_KEY}"), cookie: cookie ? cookie.slice(${COOKIE.length + 1}) : null }));`;

const writeCode = (value: string) => `localStorage.setItem("${STORAGE_KEY}", "${value}"); document.cookie = "${COOKIE}=${value}; path=/; max-age=600"; ${readCode}`;

async function loadedPage(tabId: string, url: string, other?: WebViewHandle): Promise<WebViewHandle> {
  const by = Date.now() + WAIT_MS;
  while (Date.now() < by) {
    const handle = webviews.get(tabId);
    if (handle && handle !== other) {
      const seen = parsed(await handle.evaluate(readCode).catch(() => null)) as Seen | null;
      if (seen?.href === url) return handle;
    }
    await pause(POLL_MS);
  }
  throw new Error(`the page of tab ${tabId} did not load ${url} within ${WAIT_MS} ms${other ? " in a new page view" : ""}`);
}

async function run(handle: WebViewHandle, code: string): Promise<Seen> {
  const seen = parsed(await handle.evaluate(code)) as Seen | null;
  if (!seen) throw new Error("the page gave no answer");
  return seen;
}

async function checkMovedTabProfile() {
  if (!(await lastTabClosesWindow().then(() => true, () => false))) return;
  const port = httpPagesPort();
  if (!port) throw new Error("no loopback page server: the launch has no httpPages port");
  const url = `http://127.0.0.1:${port}/a`;
  const first = S().profileOrder[0];
  if (!first) throw new Error("no profile");
  const second = S().createProfile({ name: "Self-check moved tab" });
  const made: string[] = [];
  try {
    const firstWindow = S().createWindow({ url, profileId: first });
    made.push(firstWindow);
    const secondWindow = S().createWindow({ url, profileId: second });
    made.push(secondWindow);
    const movedTab = S().windows[firstWindow]!.tabIds[0]!;
    const secondTab = S().windows[secondWindow]!.tabIds[0]!;
    const before = await loadedPage(movedTab, url);
    const seeded = await run(before, writeCode("first"));
    if (seeded.storage !== "first" || seeded.cookie !== "first") throw new Error(`the first profile's page kept no value: ${JSON.stringify(seeded)}`);
    const secondSeeded = await run(await loadedPage(secondTab, url), writeCode("second"));
    if (secondSeeded.storage !== "second" || secondSeeded.cookie !== "second") throw new Error(`the second profile's page kept no value: ${JSON.stringify(secondSeeded)}`);
    const again = await run(before, readCode);
    if (again.storage !== "first" || again.cookie !== "first") throw new Error(`the two profiles share storage before the move: ${JSON.stringify(again)}`);

    S().moveTabToProfile(movedTab, second);
    if (S().tabs[movedTab]?.profileId !== second) throw new Error("the store did not move the tab");
    const after = await loadedPage(movedTab, url, before);
    const seen = await run(after, readCode);
    if (seen.storage !== "second" || seen.cookie !== "second") throw new Error(`after the move the page reads ${JSON.stringify({ storage: seen.storage, cookie: seen.cookie })}, not the second profile's values: it still runs in the first profile`);
  } finally {
    for (const id of made) if (S().windows[id]) S().closeWindow(id);
    if (S().profiles[second]) S().deleteProfile(second);
  }
}

selfChecks.register({ name: "a tab moved to another profile gets a new page in that profile, with that profile's storage and cookies, and none of the old profile's", run: checkMovedTabProfile });
