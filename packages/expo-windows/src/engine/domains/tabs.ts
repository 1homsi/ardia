import { routeLinkTabs } from "../requestHosts";
import { ok, type Handlers } from "./calling";

export const tabCalls: Handlers = {
  routeLinkTabs: async (args) => ok(routeLinkTabs(args.strings("urls"))),
};
