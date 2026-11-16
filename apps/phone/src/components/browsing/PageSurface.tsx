import { useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { pageDrawn, pageStateChanged, pageToneChanged } from "../../state/browse/store";
import { usePageVeiled } from "../../state/browse/hooks";
import { registerPageHandle } from "../../state/pages/store";
import { tabSavedState } from "../../state/tabs/store";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { usePreferences } from "../../state/settings/hooks";
import { pageSwipe } from "../../state/settings/settingsRules";
import { PageView, useTheme, type PageViewHandle } from "../ui";

export function PageSurface({ tab, toneBottom, obscured, topClearance, testID }: { tab: BrowserTab; toneBottom: number; obscured?: { top: number; bottom: number }; topClearance?: number; testID?: string }) {
  const handle = useRef<PageViewHandle>(null);
  const theme = useTheme();
  const id = tab.id;
  const swipe = usePreferences((p) => p.swipeNavigation);
  const veiled = usePageVeiled(id);
  const [setup] = useState(() => ({ url: tab.url, title: tab.title, saved: tabSavedState(id) ?? undefined }));
  useEffect(() => {
    registerPageHandle(id, handle.current);
    return () => registerPageHandle(id, null);
  }, [id]);
  return (
    <PageView
      ref={handle}
      testID={testID}
      style={veiled ? [StyleSheet.absoluteFill, styles.veiled] : StyleSheet.absoluteFill}
      pageId={id}
      initialUrl={setup.url}
      title={setup.title}
      isPrivate={tab.isPrivate}
      savedState={setup.saved}
      toneInsets={{ top: 0, bottom: toneBottom }}
      obscuredInsets={obscured}
      topClearance={topClearance}
      swipeNavigation={pageSwipe(swipe)}
      pullToRefresh
      surfaceColor={theme.surface}
      onPageState={(state) => pageStateChanged(id, state)}
      onPageTone={(tone) => pageToneChanged(id, tone)}
      onPageDrawn={() => pageDrawn(id)}
    />
  );
}

const styles = StyleSheet.create({ veiled: { opacity: 0 } });
