import { THEME_NAMES } from "@lilo-moon/theme";
import type { ThemeMode, ThemePreference } from "@lilo-moon/theme";
import { Button } from "@lilo-moon/ui/components/button";
import { Row, Stack } from "@lilo-moon/ui/components/layout";
import { Text } from "@lilo-moon/ui/components/text";

export interface ThemeSwitcherProps {
  /** What the viewer currently has, so the active choices render pressed. */
  readonly preference: ThemePreference;
  /** Where the form posts. The application's theme route sets the cookie and redirects back. */
  readonly setPath: string;
}

const MODES: readonly ThemeMode[] = ["light", "dark"];

/**
 * Mode and theme pickers as one form of submit buttons, no client JavaScript. Each button submits
 * only its own field, the server keeps the other half from the cookie, and the redirect brings the
 * viewer back to the page they were on wearing the new preference. A round-trip per click is the
 * price of a switcher that renders correctly on the first byte and works with JavaScript off.
 */
export function ThemeSwitcher({ preference, setPath }: ThemeSwitcherProps) {
  return (
    <form method="post" action={setPath} data-slot="theme-switcher">
      <Stack gap="sm">
        <Row gap="sm">
          <Text tone="muted">Mode</Text>
          {MODES.map((mode) => (
            <Button
              key={mode}
              type="submit"
              name="mode"
              value={mode}
              size="sm"
              variant={preference.mode === mode ? "secondary" : "outline"}
              aria-pressed={preference.mode === mode}
            >
              {mode}
            </Button>
          ))}
        </Row>
        <Row gap="sm">
          <Text tone="muted">Theme</Text>
          {THEME_NAMES.map((name) => (
            <Button
              key={name}
              type="submit"
              name="theme"
              value={name}
              size="sm"
              variant={preference.theme === name ? "secondary" : "outline"}
              aria-pressed={preference.theme === name}
            >
              {name}
            </Button>
          ))}
        </Row>
      </Stack>
    </form>
  );
}
