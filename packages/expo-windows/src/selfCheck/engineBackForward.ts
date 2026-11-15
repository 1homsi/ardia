import type { AppNative, WindowsNative } from "@ardia/shell";
import { engineAvailable, hostCall, onEngineTopic } from "../engine/host";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

const CACHE_KEY = "self-check-cached-page";
const LOAD_MS = 20000;
const CACHED_MS = 3000;
const ASK_MS = 10000;

type ListedTab = { key: string; title: string };

const httpPagesPort = () => {
  const port = requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig().test?.httpPages;
  return typeof port === "string" && /^\d+$/.test(port) ? port : null;
};

const titleOf = async () => (await hostCall<{ tabs: ListedTab[] }>("tabs.list")).tabs.find((tab) => tab.key === CACHE_KEY)?.title;

const titled = async (titles: string[]) => {
  const by = Date.now() + LOAD_MS;
  let title = await titleOf();
  while (!titles.includes(title ?? "") && Date.now() < by) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    title = await titleOf();
  }
  expectTrue(titles.includes(title ?? ""), `the cached page's tab is titled ${JSON.stringify(title)}, not one of ${JSON.stringify(titles)}`);
  return title!;
};

const evaluate = async (code: string) => (await hostCall<{ result?: unknown }>("tab.call", { key: CACHE_KEY, method: "evaluate", code, userGesture: true })).result;

const ask = async (link: string) => {
  const asked = new Promise<Record<string, unknown> | null>((resolve) => {
    const watching = onEngineTopic("tab", (event: { key?: unknown; name?: unknown; data?: unknown }) => {
      if (event.key !== CACHE_KEY || event.name !== "externalApp") return;
      clearTimeout(deadline);
      watching.remove();
      resolve((event.data ?? {}) as Record<string, unknown>);
    });
    const deadline = setTimeout(() => {
      watching.remove();
      resolve(null);
    }, ASK_MS);
  });
  await evaluate(`location.href = ${JSON.stringify(link)}; post("result", "null");`);
  const data = await asked;
  if (!data) throw new Error(`no externalApp event for ${link} within ${ASK_MS} ms`);
  return data.id;
};

const alive = async (id: unknown) => (await hostCall<{ alive?: unknown }>("tab.call", { key: CACHE_KEY, method: "externalAppAlive", id })).alive;

const notRestoredReasons = () =>
  evaluate(`post("result", JSON.stringify(performance.getEntriesByType("navigation")[0]?.notRestoredReasons ?? null));`).then(
    (reasons) => String(reasons),
    (error: unknown) => `unknown (${String(error)})`,
  );

const firstWindow = async () => {
  const ids = await requireNativeModule<Pick<WindowsNative, "windowIds">>("ArdiaAppWindows").windowIds();
  expectTrue(ids.length > 0, "no window is open to host a page");
  return ids[0]!;
};

const backForwardChecks = (port: string): Check[] => [
  {
    name: "engine: an http page's ask to open another app doesn't count while the page waits in the back/forward cache, and counts again once Back shows that page",
    async run() {
      const origin = `http://127.0.0.1:${port}`;
      await hostCall("tab.create", { key: CACHE_KEY, url: `${origin}/a`, profile: "" }, await firstWindow());
      try {
        await titled(["loaded a"]);
        const cachedAsk = await ask("ardia-self-check-link:cached");
        await hostCall("tab.call", { key: CACHE_KEY, method: "loadUrl", url: `${origin}/b` });
        await titled(["loaded b"]);
        await new Promise((resolve) => setTimeout(resolve, CACHED_MS));
        const whileCached = await alive(cachedAsk);
        await hostCall("tab.call", { key: CACHE_KEY, method: "goBack" });
        const back = await titled(["restored a", "loaded a"]);
        const reasons = back === "restored a" ? "" : await notRestoredReasons();
        const oldAskAfterBack = await alive(cachedAsk);
        const freshAsk = await alive(await ask("ardia-self-check-link:after-back"));
        expectEqual(
          { restoredFromTheCache: back === "restored a", whileCached, oldAskAfterBack, freshAsk },
          { restoredFromTheCache: true, whileCached: false, oldAskAfterBack: true, freshAsk: true },
          `externalAppAlive around the back/forward cache${reasons ? `; the page wasn't restored from the cache: ${reasons}` : ""}`,
        );
      } finally {
        await hostCall("tab.close", { key: CACHE_KEY });
      }
    },
  },
];

const port = engineAvailable() ? httpPagesPort() : null;

export const checks: Check[] = port ? backForwardChecks(port) : [];
