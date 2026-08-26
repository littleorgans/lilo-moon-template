import { COLOR_TOKENS } from "@lilo-moon/theme";
import type { ThemePreference } from "@lilo-moon/theme";
import { Badge } from "@lilo-moon/ui/components/badge";
import { Button } from "@lilo-moon/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lilo-moon/ui/components/card";
import { Input } from "@lilo-moon/ui/components/input";
import { Label } from "@lilo-moon/ui/components/label";
import { Container, Row, Stack } from "@lilo-moon/ui/components/layout";
import { Code, CodeBlock, Heading, Text } from "@lilo-moon/ui/components/text";

import { ThemeSwitcher } from "../theme-switcher/theme-switcher.js";

export interface ThemeLabProps {
  readonly preference: ThemePreference;
  /** Where the switcher posts. See `ThemeSwitcher`. */
  readonly setPath: string;
}

const BUTTON_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "ghost",
  "destructive",
  "link",
] as const;
const BADGE_VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

/**
 * Every component and every color token on one page, wearing the live preference. This is where a
 * theme is judged and iterated: change a palette, `just theme-generate`, reload, and the whole
 * surface answers at once. The swatches read the CSS variables at render, so what they show is
 * what the stylesheet actually resolved, not what the source claims.
 */
export function ThemeLab({ preference, setPath }: ThemeLabProps) {
  return (
    <main>
      <Container>
        <Stack gap="lg">
          <Row justify="between">
            <Heading>Theme lab</Heading>
            <Button asChild variant="ghost" size="sm">
              <a href="/">Back</a>
            </Button>
          </Row>

          <Card>
            <CardHeader>
              <CardTitle>Preference</CardTitle>
              <CardDescription>
                Carried in the <Code>theme</Code> cookie, applied to <Code>&lt;html&gt;</Code> on
                the server, so the first paint is already right.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeSwitcher preference={preference} setPath={setPath} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Buttons and badges</CardTitle>
            </CardHeader>
            <CardContent>
              <Stack gap="sm">
                <Row gap="sm">
                  {BUTTON_VARIANTS.map((variant) => (
                    <Button key={variant} variant={variant} type="button">
                      {variant}
                    </Button>
                  ))}
                </Row>
                <Row gap="sm">
                  {BADGE_VARIANTS.map((variant) => (
                    <Badge key={variant} variant={variant}>
                      {variant}
                    </Badge>
                  ))}
                </Row>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Form and text</CardTitle>
            </CardHeader>
            <CardContent>
              <Stack gap="md">
                <Stack gap="sm">
                  <Label htmlFor="theme-lab-input">A labelled field</Label>
                  <Input id="theme-lab-input" placeholder="Placeholder text" />
                </Stack>
                <Heading level={2}>A second-level heading</Heading>
                <Text>Default text with a line of ordinary reading copy.</Text>
                <Text tone="muted">Muted text, the tone captions and hints use.</Text>
                <Text tone="destructive">Destructive text, the tone errors use.</Text>
                <CodeBlock>{'{ "code": "block" }'}</CodeBlock>
              </Stack>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Color tokens</CardTitle>
              <CardDescription>
                Each swatch reads its CSS variable live, so this is the resolved palette.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                data-slot="swatch-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(10rem, 1fr))",
                  gap: "0.5rem",
                }}
              >
                {COLOR_TOKENS.map((token) => (
                  <Stack key={token} gap="xs">
                    <div
                      data-token={token}
                      style={{
                        background: `var(--${token})`,
                        height: "2.5rem",
                        borderRadius: "var(--radius)",
                        border: "1px solid var(--border)",
                      }}
                    />
                    <Text size="small" tone="muted">
                      {token}
                    </Text>
                  </Stack>
                ))}
              </div>
            </CardContent>
          </Card>
        </Stack>
      </Container>
    </main>
  );
}
