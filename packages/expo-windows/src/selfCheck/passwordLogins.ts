import type { AppNative } from "@ardia/shell";
import { engineAvailable, engineCallJson } from "../engine/host";
import { requireNativeModule } from "../modules";
import { expectEqual, type Check } from "./check";

const ONE = { origin: "https://ardia-self-check-one.example", username: "one", password: "self-check-one" };
const TWO = { origin: "https://ardia-self-check-two.example", username: "two", password: "self-check-two" };
const OURS = "ardia-self-check-";

type Reply = { error?: unknown; logins?: unknown; passwords?: unknown };

const call = async (name: string, args: object = {}) => JSON.parse(await engineCallJson(name, "", JSON.stringify(args))) as Reply;

const entries = (list: unknown, origin: "realm" | "origin") =>
  Array.isArray(list)
    ? list
        .map((entry) => (typeof entry === "object" && entry !== null ? `${String((entry as Record<string, unknown>)[origin] ?? "")} ${String((entry as Record<string, unknown>).username ?? "")}` : ""))
        .filter((entry) => entry.includes(OURS))
        .map((entry) => (entry.includes(`${OURS}one`) ? "one" : "two"))
        .sort()
    : null;

const syncRead = async () => {
  const reply = await call("ac_passwords_logins");
  return reply.error !== undefined ? { error: reply.error } : { logins: entries(reply.logins, "realm") };
};

const settingsList = async () => {
  const reply = await call("ac_passwords_list");
  return reply.error !== undefined ? { error: reply.error } : { passwords: entries(reply.passwords, "origin") };
};

const savedChecks: Check[] = [
  {
    name: "passwords: Sync's login read lists every saved login, as Settings does",
    async run() {
      for (const login of [ONE, TWO]) expectEqual((await call("ac_passwords_add", login)).error, undefined, `the error saving ${login.origin}`);
      expectEqual(await syncRead(), { logins: ["one", "two"] }, "ac_passwords_logins");
      expectEqual(await settingsList(), { passwords: ["one", "two"] }, "ac_passwords_list");
    },
  },
];

const stages: Record<string, Check[]> = {
  undecryptableLogin: [
    {
      name: "passwords: with one saved login that can't be decrypted, Sync's read fails as undecryptable while Settings still lists the other",
      async run() {
        expectEqual(await syncRead(), { error: "undecryptable" }, "ac_passwords_logins with a corrupt row");
        expectEqual(await settingsList(), { passwords: ["one"] }, "ac_passwords_list with a corrupt row");
      },
    },
  ],
  undecryptableRemoved: [
    {
      name: "passwords: once the login that couldn't be decrypted is gone, Sync's read lists the rest again",
      async run() {
        expectEqual(await syncRead(), { logins: ["one"] }, "ac_passwords_logins after the corrupt row was removed");
      },
    },
  ],
};

export const checks: Check[] = engineAvailable() ? savedChecks : [];

export function stageChecks(): Check[] | null {
  const stage = requireNativeModule<Pick<AppNative, "launchConfig">>("ArdiaApp").launchConfig().test?.selfCheckStage;
  return typeof stage === "string" && stage ? (stages[stage] ?? []) : null;
}
