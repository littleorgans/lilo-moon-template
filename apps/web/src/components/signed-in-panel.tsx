import { Badge } from "@lilo-moon/ui/components/badge";
import { Button } from "@lilo-moon/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lilo-moon/ui/components/card";
import { Container, Row, Stack } from "@lilo-moon/ui/components/layout";
import { Code, CodeBlock, Heading } from "@lilo-moon/ui/components/text";
import { Text } from "@lilo-moon/ui/components/text";
import { getRouteApi } from "@tanstack/react-router";

// Resolved once at module scope: a hook selected off a fresh object on every render is a different
// function each time, which is exactly what the rules of hooks forbid.
const routeApi = getRouteApi("/app");

import { App as TaskBoard } from "../app.js";
import type { SignedInView } from "../server/signed-in.js";

/** Pure on purpose: it takes its data as props so it can be rendered without a router or a session. */
export function SignedInPanel({ principal, rows, databaseError }: SignedInView) {
  return (
    <main>
      <Container>
        <Stack gap="lg">
          <Row justify="between">
            <Heading>Signed in</Heading>
            <Button asChild variant="outline" size="sm">
              <a href="/api/auth/signout">Sign out</a>
            </Button>
          </Row>

          <Card>
            <CardHeader>
              <CardTitle>Principal</CardTitle>
              <CardDescription>
                The whole Principal, verbatim. An empty <Code>entitlements</Code> list is correct
                until Stripe Connect is configured, and <Code>orgId</Code> being present is what
                proves the organization was created and the token refreshed afterwards.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CodeBlock>{JSON.stringify(principal, null, 2)}</CodeBlock>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rows visible to this Principal</CardTitle>
            </CardHeader>
            <CardContent>
              {rows === null ? (
                <Text tone="muted">
                  {databaseError === null
                    ? "DATABASE_URL is not set, so no scoped transaction ran."
                    : `The scoped transaction failed: ${databaseError}`}
                </Text>
              ) : (
                <Row gap="sm">
                  <Badge variant="secondary">accounts: {rows.accounts}</Badge>
                  <Badge variant="secondary">profiles: {rows.profiles}</Badge>
                </Row>
              )}
            </CardContent>
          </Card>

          <Stack gap="sm">
            <Heading level={2}>The product</Heading>
            <TaskBoard />
          </Stack>
        </Stack>
      </Container>
    </main>
  );
}

/**
 * The route's component.
 *
 * Reads the loader's data through `getRouteApi` rather than importing the route, which would be a
 * cycle: the route names this component. Kept separate from the panel so the panel stays pure and
 * can be rendered without a router.
 */
export function SignedInRoute() {
  return <SignedInPanel {...routeApi.useLoaderData()} />;
}
