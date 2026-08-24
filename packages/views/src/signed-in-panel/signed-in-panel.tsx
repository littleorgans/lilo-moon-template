import type { Principal } from "@lilo-moon/auth";
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
import { Code, CodeBlock, Heading, Text } from "@lilo-moon/ui/components/text";
import type { ReactNode } from "react";

/** What the signed-in page shows about the database. Produced by the application's loader. */
export interface VisibleRows {
  readonly accounts: number;
  readonly profiles: number;
}

export interface SignedInPanelProps {
  readonly principal: Principal;
  /** Null when DATABASE_URL is unset, which is a runnable state rather than a broken one. */
  readonly rows: VisibleRows | null;
  /** Reported rather than thrown, so a broken database still shows the verified Principal. */
  readonly databaseError: string | null;
  /** The product surface. The view renders it under its own heading without knowing what it is. */
  readonly children?: ReactNode;
}

/** Pure on purpose: it takes its data as props so it can be rendered without a router or a session. */
export function SignedInPanel({ principal, rows, databaseError, children }: SignedInPanelProps) {
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

          {children === undefined ? null : (
            <Stack gap="sm">
              <Heading level={2}>The product</Heading>
              {children}
            </Stack>
          )}
        </Stack>
      </Container>
    </main>
  );
}
