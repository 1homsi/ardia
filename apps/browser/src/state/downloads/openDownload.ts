import { fileExists, openFile, revealFile } from "../../platform/files";
import { PLATFORM_FEATURES } from "../../lib/platformFeatures";
import { noteDownloadsPanel } from "../telemetry/downloadsPanelCounts";

const ARCHIVE = /\.(?:zip|tar|tgz|tbz|tbz2|txz|cpio|tar\.gz|tar\.bz2|tar\.xz|gz|bz2|xz)$/i;
const POLL_MS = 250;
const UNPACK_WAIT_MS = 30_000;

export type OpenDownloadDeps = {
  exists: (path: string) => boolean;
  open: (path: string) => Promise<boolean>;
  reveal: (path: string) => Promise<boolean>;
  wait: (ms: number) => Promise<void>;
};

const SYSTEM: OpenDownloadDeps = {
  exists: fileExists,
  open: openFile,
  reveal: revealFile,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export const isArchive = (path: string) => ARCHIVE.test(path);

export function unpackedPath(path: string, exists: (path: string) => boolean): string | null {
  const stem = path.replace(ARCHIVE, "");
  if (!stem || stem === path) return null;
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? stem : `${stem} ${n}`;
    if (!exists(candidate)) return candidate;
  }
  return null;
}

export async function openDownload(path: string, deps: OpenDownloadDeps = SYSTEM): Promise<boolean> {
  if (!PLATFORM_FEATURES.unpacksArchivesSilently || !isArchive(path)) return deps.open(path);
  const unpacked = unpackedPath(path, deps.exists);
  if (!(await deps.open(path))) return false;
  noteDownloadsPanel("archiveOpen");
  await deps.reveal(path);
  if (!unpacked) return true;
  for (let waited = 0; waited < UNPACK_WAIT_MS; waited += POLL_MS) {
    await deps.wait(POLL_MS);
    if (!deps.exists(unpacked)) continue;
    noteDownloadsPanel("archiveUnpackedShown");
    await deps.reveal(unpacked);
    return true;
  }
  return true;
}
