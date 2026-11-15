import { act } from "react-test-renderer";
import { SpacesView } from "../components/sync/SpacesView";
import * as nav from "../state/settings/nav";
import { useSpaceOpen } from "../state/sync/spaceOpen";
import { useSync } from "../state/sync/store";
import { status, view } from "../../test/syncFixture";
import { pressButton, renderSurface, textOf, unmount, withTabs } from "../../test/render/harness";

beforeEach(() => {
  jest.useFakeTimers();
  withTabs(1);
  useSpaceOpen.setState({}, true);
});

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const withWorkSpace = (patch: (profiles: ReturnType<typeof view>["profiles"]) => ReturnType<typeof view>["profiles"] = (profiles) => profiles) => {
  const base = view();
  useSync.setState((state) => ({ ...state, status: status({ isEnabled: true, phase: "updated" }), view: { ...base, profiles: patch(base.profiles), selectedProfileId: "work", shownProfileId: "work" } }));
};

test("a pinned tab with a symbol shows the symbol, as Compose's RemoteRow, not a favicon", () => {
  withWorkSpace((profiles) =>
    profiles.map((profile) => (profile.syncId === "work" ? { ...profile, pinned: { ...profile.pinned, sections: [{ tab: { key: "p1", title: "Starred", url: "https://star.example/", icon: "star.fill" }, group: null }] } } : profile)),
  );
  const root = renderSurface(<SpacesView />);
  const symbols = root.root.findAll((node) => node.props.testID === "spaceTabSymbol" && typeof node.type === "string");
  expect(symbols.length).toBeGreaterThan(0);
  expect(symbols[0]!.findAll((node) => node.props.name === "starFill").length).toBeGreaterThan(0);
  unmount(root);
});

test("a group opened in a space is still open the next time Spaces opens, for that profile", async () => {
  withWorkSpace();
  const first = renderSurface(<SpacesView />);
  expect(textOf(first)).not.toContain("Plan");
  await pressButton(first, "Launch");
  expect(textOf(first)).toContain("Plan");
  unmount(first);
  const again = renderSurface(<SpacesView />);
  expect(textOf(again)).toContain("Plan");
  unmount(again);
});

test("with sync off, the empty Spaces' Sync With Mac opens Connect, as Compose's sync setup, not Settings › Sync", async () => {
  const opened = jest.spyOn(nav, "openSettings");
  useSync.setState((state) => ({ ...state, status: status({ isEnabled: false, phase: "off" }), view: { ...view(), profiles: [] } }));
  const root = renderSurface(<SpacesView />);
  await pressButton(root, "Sync With Mac");
  expect(opened).toHaveBeenCalledWith({ page: "syncConnect" });
  unmount(root);
});
