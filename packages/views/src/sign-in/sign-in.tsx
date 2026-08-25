import { Button } from "@lilo-moon/ui/components/button";
import { Input } from "@lilo-moon/ui/components/input";
import { Container, Stack } from "@lilo-moon/ui/components/layout";
import { Heading, Text } from "@lilo-moon/ui/components/text";

export interface SignInPanelProps {
  readonly title: string;
  readonly description: string;
  /** The server route that starts the redirect sign-in. An anchor, so the route can set cookies. */
  readonly oauthStartPath: string;
  /** The server route that emails a one-time code. A form post, for the same reason. */
  readonly emailStartPath: string;
  /** True when the person arrived because their session stopped verifying. */
  readonly sessionEnded?: boolean;
}

/**
 * The signed-out page: both ways in, one screen.
 *
 * The session-ended notice names no reason, and the wording lives here rather than arriving as a
 * prop. A token can fail its signature, its issuer or its audience because somebody is probing
 * with one they minted, and a message naming the failed check tells them which knob to turn. That
 * rule belongs to the screen, so no application can weaken it by passing friendlier copy.
 *
 * Sign-in is an anchor and a form, never a fetch. Both routes have to set a cookie and then move
 * the browser somewhere else, and both of those are things a top-level navigation does and an XHR
 * does not. `Button asChild` keeps the anchor while borrowing the button's look.
 */
export function SignInPanel({
  title,
  description,
  oauthStartPath,
  emailStartPath,
  sessionEnded = false,
}: SignInPanelProps) {
  return (
    <main>
      <Container size="sm">
        <Stack gap="lg" align="center">
          <Heading>{title}</Heading>
          {sessionEnded ? (
            <Text data-status="session-ended">Your session ended. Sign in again to continue.</Text>
          ) : null}
          <Text tone="muted">{description}</Text>
          <Button asChild>
            <a href={oauthStartPath}>Continue with Google</a>
          </Button>
          <Text tone="muted" size="small">
            or
          </Text>
          <form method="post" action={emailStartPath}>
            <Stack gap="sm">
              <Input
                type="email"
                name="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                aria-label="Email address"
              />
              <Button type="submit" variant="outline">
                Email me a sign-in code
              </Button>
            </Stack>
          </form>
        </Stack>
      </Container>
    </main>
  );
}
