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
}

/**
 * The signed-out page: both ways in, one screen.
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
}: SignInPanelProps) {
  return (
    <main>
      <Container size="sm">
        <Stack gap="lg" align="center">
          <Heading>{title}</Heading>
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
