import { Button } from "@lilo-moon/ui/components/button";
import { Container, Stack } from "@lilo-moon/ui/components/layout";
import { Heading, Text } from "@lilo-moon/ui/components/text";

export interface SessionErrorPanelProps {
  /** Shown so somebody reporting the problem has something to quote. */
  readonly supportHint?: string;
  readonly retryPath?: string;
}

/** Unreadable account claims need support; temporary outages preserve the session and offer retry. */
export function SessionErrorPanel({ supportHint, retryPath }: SessionErrorPanelProps) {
  return (
    <main>
      <Container size="sm">
        <Stack gap="lg" align="center">
          <Heading>
            {retryPath === undefined
              ? "Something is wrong on our side"
              : "Sign-in is temporarily unavailable"}
          </Heading>
          <Text tone="muted">
            {retryPath === undefined
              ? "You are signed in, but this application could not read your account details. Signing in again will not help, so it has been recorded for us to fix."
              : "Your session has been kept. Please try again in a moment."}
          </Text>
          {retryPath === undefined ? null : (
            <Button asChild>
              <a href={retryPath}>Try again</a>
            </Button>
          )}
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
