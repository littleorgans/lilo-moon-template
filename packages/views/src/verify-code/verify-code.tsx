import { Button } from "@lilo-moon/ui/components/button";
import { Input } from "@lilo-moon/ui/components/input";
import { Container, Stack } from "@lilo-moon/ui/components/layout";
import { Heading, Text } from "@lilo-moon/ui/components/text";

export interface VerifyCodePanelProps {
  /** The server route the code is posted to. */
  readonly verifyPath: string;
  /** Where a person who wants a fresh code, or typed the wrong address, starts over. */
  readonly startOverPath: string;
  /** True when the previous code was refused; the copy says so instead of pretending otherwise. */
  readonly retry: boolean;
}

/**
 * The code entry page, second half of the email sign-in.
 *
 * The address is deliberately not shown: it lives in an httpOnly cookie the page cannot read, and
 * echoing it back through a loader would put it in the server-rendered HTML for anyone at the
 * keyboard of a shared machine. The person typed it seconds ago.
 */
export function VerifyCodePanel({ verifyPath, startOverPath, retry }: VerifyCodePanelProps) {
  return (
    <main>
      <Container size="sm">
        <Stack gap="lg" align="center">
          <Heading>Check your email</Heading>
          <Text tone="muted">
            We sent a six-digit code to your address. It expires in ten minutes.
          </Text>
          {retry ? (
            <Text tone="destructive" data-status="retry">
              That code did not work. Check it and try again, or start over for a fresh one.
            </Text>
          ) : null}
          <form method="post" action={verifyPath}>
            <Stack gap="sm">
              <Input
                name="code"
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                aria-label="Six-digit code"
              />
              <Button type="submit">Sign in</Button>
            </Stack>
          </form>
          <Button asChild variant="ghost" size="sm">
            <a href={startOverPath}>Use a different address</a>
          </Button>
        </Stack>
      </Container>
    </main>
  );
}
