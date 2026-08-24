import { Button } from "@lilo-moon/ui/components/button";
import { Container, Stack } from "@lilo-moon/ui/components/layout";
import { Heading, Text } from "@lilo-moon/ui/components/text";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: SignIn,
});

/**
 * The signed-out page.
 *
 * Sign-in is an anchor to a server route, not a fetch. The route has to set the `state` cookie and
 * then hand the browser to the provider, and both of those are things a top-level navigation does
 * and an XHR does not. `Button asChild` keeps the anchor while borrowing the button's look.
 */
function SignIn() {
  return (
    <main>
      <Container size="sm">
        <Stack gap="lg" align="center">
          <Heading>Task board</Heading>
          <Text tone="muted">Sign in to see the tasks your workspace can see.</Text>
          <Button asChild>
            <a href="/api/auth/start">Continue with Google</a>
          </Button>
          <Text tone="muted" size="small">
            Email codes are next on the roadmap; Google is the proven path today.
          </Text>
        </Stack>
      </Container>
    </main>
  );
}
