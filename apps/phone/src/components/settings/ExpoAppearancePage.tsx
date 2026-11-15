import { PlatformColor } from "react-native";
import { Button, Form, HStack, Section, Text, Toggle, VStack } from "@expo/ui/swift-ui";
import { accessibilityAddTraits, accessibilityLabel, buttonStyle, frame, navigationBarTitleDisplayMode, navigationTitle, tint } from "@expo/ui/swift-ui/modifiers";
import { INTERFACE_STYLE_NAMES, INTERFACE_STYLES, SCHEME_CHOICES, SCHEME_NAMES } from "../../lib/appearance";
import { setColorChoice, setInterfaceStyle, setSchemeChoice } from "../../state/settings/actions";
import { usePreferences } from "../../state/settings/hooks";
import { matchMyMac } from "../../state/sync/actions";
import { useSyncEnabled } from "../../state/sync/hooks";
import { CheckmarkLabel, ColorSwatch, modifierList, PROFILE_COLORS, settingsChrome, settingsSwitchStyle, settingsUIAvailable, useProfileLook, type ProfileColor } from "../ui";

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[];
const FILL = Number.MAX_SAFE_INTEGER;

export function ExpoAppearancePage() {
  const syncEnabled = useSyncEnabled();
  const style = usePreferences((p) => p.interfaceStyle);
  const scheme = usePreferences((p) => p.schemeChoice);
  const chosen = usePreferences((p) => p.colorChoice);
  const look = useProfileLook();
  return (
    <Form modifiers={modifierList(navigationTitle("Appearance"), navigationBarTitleDisplayMode("inline"), tint(PlatformColor("systemBlue")), settingsChrome())}>
      <Section>
        <VStack alignment="leading" spacing={12}>
          <Text>Color</Text>
          <HStack spacing={0}>
            {COLORS.map((color) => (
              <Swatch key={color} color={color} selected={color === look.preset} />
            ))}
          </HStack>
        </VStack>
        {syncEnabled ? (
          <Toggle isOn={chosen === null} onIsOnChange={(on) => matchMyMac(on, look)} modifiers={modifierList(settingsSwitchStyle())}>
            <Text>Match My Mac</Text>
          </Toggle>
        ) : null}
      </Section>
      <Section title="Interface Style" footer={<Text>Match My Mac follows your Mac. Reduce Transparency in iOS Settings always uses Classic.</Text>}>
        {INTERFACE_STYLES.map((choice) => (
          <Choice key={choice} title={INTERFACE_STYLE_NAMES[choice]} checked={style === choice} onPress={() => setInterfaceStyle(choice)} />
        ))}
      </Section>
      <Section title="Light or Dark" footer={<Text>Match My Mac follows your Mac. System follows this device.</Text>}>
        {SCHEME_CHOICES.map((choice) => (
          <Choice key={choice} title={SCHEME_NAMES[choice]} checked={scheme === choice} onPress={() => setSchemeChoice(choice)} />
        ))}
      </Section>
    </Form>
  );
}

function Swatch({ color, selected }: { color: ProfileColor; selected: boolean }) {
  const name = PROFILE_COLORS[color].name;
  return (
    <Button onPress={() => setColorChoice(color)} modifiers={[buttonStyle("plain"), frame({ maxWidth: FILL }), accessibilityLabel(name), accessibilityAddTraits(selected ? ["isButton", "isSelected"] : ["isButton"])]}>
      {settingsUIAvailable() ? <ColorSwatch preset={color} isSelected={selected} /> : <Text>{name}</Text>}
    </Button>
  );
}

function Choice({ title, checked, onPress }: { title: string; checked: boolean; onPress: () => void }) {
  return (
    <Button onPress={onPress} modifiers={[tint("primary"), accessibilityAddTraits(checked ? ["isSelected"] : [])]}>
      {settingsUIAvailable() ? <CheckmarkLabel title={title} isChecked={checked} /> : <Text>{checked ? `${title} ✓` : title}</Text>}
    </Button>
  );
}
