import { create } from "zustand";
import { haptics } from "../app/haptics";
import { presentSearch } from "../search/store";
import { closeSettings } from "../settings/nav";
import { defaultBrowserStatus, refreshDefaultBrowser } from "../settings/defaultBrowser";
import { keepRestorable, restoredValue } from "../../platform/restorable";
import { nextStep, offersDefaultBrowser, previousStep, restoredOnboardingStep, type OnboardingStep } from "../settings/settingsRules";
import { currentPreferences, setPreference } from "../settings/store";
import { useTabs } from "../tabs/store";
import { heldLinks } from "../links/heldLinks";
import { opensLaunchTray } from "../links/linkRules";
import { syncOffered } from "../../platform/system";

export const useOnboarding = create<{ showing: boolean; step: OnboardingStep; forward: boolean }>()(() => ({ showing: false, step: "welcome", forward: true }));

export const onboardingShowing = () => useOnboarding.getState().showing;

const STEP_KEY = "onboarding.step";

useOnboarding.subscribe((state, previous) => {
  if (state.showing === previous.showing && state.step === previous.step) return;
  keepRestorable(STEP_KEY, state.showing ? state.step : null);
});

export function showOnboarding() {
  closeSettings();
  useOnboarding.setState({ showing: true, step: restoredOnboardingStep(restoredValue(STEP_KEY), syncOffered()), forward: true });
  void refreshDefaultBrowser();
}

const offers = () => offersDefaultBrowser(defaultBrowserStatus());

export function advanceOnboarding() {
  const next = nextStep(useOnboarding.getState().step, offers(), syncOffered());
  if (!next) {
    finishOnboarding();
    return;
  }
  haptics.selection();
  useOnboarding.setState({ step: next, forward: true });
}

export function onboardingBack(): boolean {
  const { showing, step } = useOnboarding.getState();
  if (!showing) return false;
  const previous = previousStep(step, offers(), syncOffered());
  if (previous) useOnboarding.setState({ step: previous, forward: false });
  else finishOnboarding();
  return true;
}

export function finishOnboarding() {
  if (useOnboarding.getState().showing) haptics.success();
  const raisesTray = opensLaunchTray(currentPreferences().autoOpensKeyboard, heldLinks());
  setPreference("hasFinishedOnboarding", true);
  useOnboarding.setState({ showing: false });
  if (raisesTray) presentSearch("home", "", useTabs.getState().incognito);
}
