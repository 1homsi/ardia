import { useMemo } from "react";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { PLATFORM_TERMS } from "../../lib/platformTerms";
import { experimentOn } from "../../platform/killSwitches";
import { openSettings } from "../settings/settingsWindows";
import { waitForInstall, type InstallResult } from "./installWaiters";
import { requestPluginConsent } from "./lifecycle";
import { relinkPrograms } from "./programs";
import { activeManifest, currentPlugins, isAlwaysOn, isInstalled, usePlugins, type PluginListing, type PluginsStore } from "./store";

export type OfficialPluginState = "available" | "installed" | "comingSoon" | "unsupported";
export type OfficialPlugin = { name: string; title: string; blurb: string; icon: string; version: string | null; state: OfficialPluginState };
type Entry = Omit<OfficialPlugin, "state" | "version">;
type ComingSoon = Entry & { experiment: "officialPluginsAi" };

export const OFFICIAL_CATALOGUE: readonly Entry[] = [
  { name: "cli", title: "Command Line", blurb: "The ardia command: drive Ardia, read pages and run its commands from your terminal or an agent.", icon: "terminal" },
];

export const COMING_SOON: readonly ComingSoon[] = [
  { name: "ai", title: "AI", blurb: "A chat that reads and uses your tabs with your permission, on your own Claude plan.", icon: "sparkles", experiment: "officialPluginsAi" },
];

const officialListing = (s: Pick<PluginsStore, "listings">, name: string): PluginListing | undefined => {
  const listing = Object.hasOwn(s.listings, name) ? s.listings[name] : undefined;
  return listing?.bundled && listing.manifest?.official ? listing : undefined;
};

function installedOf(s: Pick<PluginsStore, "listings" | "records">, listing: PluginListing): boolean {
  return isAlwaysOn(listing) ? isInstalled(s, listing.name) : !!activeManifest(s, listing.name);
}

export function officialPlugins(
  s: Pick<PluginsStore, "listings" | "records" | "order">,
  supported: boolean = PLATFORM_FEATURES.plugins,
  showComingSoon: (experiment: ComingSoon["experiment"]) => boolean = experimentOn,
): OfficialPlugin[] {
  const bundled = s.order.filter((name) => officialListing(s, name)).map((name) => ({ name, title: "", blurb: "", icon: "" }));
  const entries = [...OFFICIAL_CATALOGUE, ...bundled.filter((b) => !OFFICIAL_CATALOGUE.some((e) => e.name === b.name))];
  const out: OfficialPlugin[] = entries.map((entry) => {
    const listing = officialListing(s, entry.name);
    const m = listing?.manifest;
    const shown = { name: entry.name, title: m?.title ?? entry.title, blurb: m?.description || entry.blurb, icon: m?.icon ?? m?.page?.icon ?? (entry.icon || "puzzlepiece"), version: m?.version ?? null };
    if (!supported || !listing) return { ...shown, state: "unsupported" };
    return { ...shown, state: installedOf(s, listing) ? "installed" : "available" };
  });
  for (const soon of COMING_SOON) {
    if (!showComingSoon(soon.experiment) || out.some((o) => o.name === soon.name)) continue;
    out.push({ name: soon.name, title: soon.title, blurb: soon.blurb, icon: soon.icon, version: null, state: supported ? "comingSoon" : "unsupported" });
  }
  return out;
}

export function useOfficialPlugins(): OfficialPlugin[] {
  const key = usePlugins((s) => JSON.stringify(officialPlugins(s)));
  return useMemo(() => JSON.parse(key) as OfficialPlugin[], [key]);
}

function linkOutcome(name: string): InstallResult | null {
  const s = currentPlugins();
  if (!activeManifest(s, name)?.programs.length) return { ok: true };
  const programs = s.programs[name];
  if (!programs || programs.state === "linking" || programs.hash !== s.listings[name]?.hash) return null;
  if (programs.state === "failed") return { ok: false, reason: `It's installed, but its commands couldn't go on PATH: ${programs.reason}` };
  const refused = Object.values(programs.refused);
  return refused.length ? { ok: false, reason: `It's installed, but ${refused[0]}` } : { ok: true };
}

function linked(name: string): Promise<InstallResult> {
  return new Promise((resolve) => {
    const now = linkOutcome(name);
    if (now) return resolve(now);
    const stop = usePlugins.subscribe(() => {
      const outcome = linkOutcome(name);
      if (!outcome) return;
      stop();
      resolve(outcome);
    });
  });
}

export function installOfficialPlugin(name: string, options: { showSheet?: boolean } = {}): Promise<InstallResult> {
  if (!PLATFORM_FEATURES.plugins) return Promise.resolve({ ok: false, reason: `Plugins aren't available on ${PLATFORM_TERMS.os} yet.` });
  const s = currentPlugins();
  const listing = officialListing(s, name);
  if (!listing) return Promise.resolve({ ok: false, reason: `${name} isn't an official plugin in this Ardia.` });
  if (installedOf(s, listing)) {
    relinkPrograms(name);
    return linked(name);
  }
  if (!listing.manifest || !listing.hash) return Promise.resolve({ ok: false, reason: listing.problems[0] ?? `${name} can't load.` });
  if (!requestPluginConsent(name)) return Promise.resolve({ ok: false, reason: `${name} can't be installed right now.` });
  const done = waitForInstall(name);
  if (options.showSheet !== false) openSettings("plugins", null, name);
  return done.then((result) => (result.ok ? linked(name) : result));
}
