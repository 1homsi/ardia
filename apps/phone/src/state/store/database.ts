import type { SqlDatabase } from "../../lib/sqlDatabase";
import { openMemoryDatabase, openSqlDatabase } from "../../platform/database";
import { newUuid } from "../../lib/ids";
import { demoSeed } from "../app/demoSeed";
import { launchArguments } from "../app/launchFlags";
import { writeImport } from "./browserDatabase";
import { DATABASE_FILE, migrate } from "./schema";

const DEMO_MARKER = "demo.seeded";

let opened: SqlDatabase | null = null;
let durable = false;

export const browserDatabaseIsDurable = () => {
  browserDatabase();
  return durable;
};

export function browserDatabase(): SqlDatabase {
  if (opened) return opened;
  if (launchArguments().isDemo) {
    const demo = openMemoryDatabase();
    migrate(demo);
    writeImport(demo, demoSeed(Date.now(), newUuid), DEMO_MARKER, "1");
    opened = demo;
    return opened;
  }
  const file = openSqlDatabase(DATABASE_FILE);
  if ("refused" in migrate(file)) {
    const memory = openMemoryDatabase();
    migrate(memory);
    opened = memory;
  } else {
    opened = file;
    durable = true;
  }
  return opened;
}
