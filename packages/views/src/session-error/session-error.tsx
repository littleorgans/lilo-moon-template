import { Container, Stack } from "@lilo-moon/ui/components/layout";
import { Heading, Text } from "@lilo-moon/ui/components/text";

export interface SessionErrorPanelProps {
  /** Shown so somebody reporting the problem has something to quote. */
  readonly supportHint?: string;
}

/**
 * The screen for a token that was genuinely issued to this person and then made no sense to us.
 *
 * **No sign-in button, deliberately.** Every other verification failure is fixed by signing in
 * again; this one is not, because the next token will have the same shape as the one already
 * rejected. Offering the button would invite somebody to press it forever while nothing improves.
 * The failure is on its way to whoever reads the logs, and saying so is more honest than a
 * control that cannot work.
 */
export function SessionErrorPanel({ supportHint }: SessionErrorPanelProps) {
  return (
    <main>
      <Container size="sm">
        <Stack gap="lg" align="center">
          <Heading>Something is wrong on our side</Heading>
          <Text tone="muted">
            You are signed in, but this application could not read your account details. Signing in
            again will not help, so it has been recorded for us to fix.
          </Text>
          {supportHint === undefined ? null : (
            <Text tone="muted" size="small" data-slot="support-hint">
              {supportHint}
            </Text>
          )}
        </Stack>
      </Container>
    </main>
  );
}
