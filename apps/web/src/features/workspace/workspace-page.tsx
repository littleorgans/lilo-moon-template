import { Badge } from "@littleorgans/ui/components/badge";
import { Button } from "@littleorgans/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@littleorgans/ui/components/card";
import { Container, Row, Stack } from "@littleorgans/ui/components/layout";
import { Code, Heading, Text } from "@littleorgans/ui/components/text";

import type { WorkspaceView } from "./model.js";

/** The signed-in page: who the session belongs to, what the scoped transaction sees, and sign out. */
export function WorkspacePage({ principal, rows, databaseError }: WorkspaceView) {
  return (
    <main>
      <Container>
        <Stack gap="lg">
          <Row justify="between">
            <Heading>Signed in</Heading>
            <form action="/api/auth/signout" method="post">
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </Row>

          <Card>
            <CardHeader>
              <CardTitle>Session</CardTitle>
              <CardDescription>The verified identity this page runs as.</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="sm">
                <Text>
                  User <Code>{principal.userId}</Code>
                </Text>
                <Text tone={principal.orgId === null ? "muted" : "default"}>
                  {principal.orgId === null ? (
                    "No organization"
                  ) : (
                    <>
                      Organization <Code>{principal.orgId}</Code>
                    </>
                  )}
                </Text>
              </Stack>
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
        </Stack>
      </Container>
    </main>
  );
}
