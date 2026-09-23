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
import { Code, CodeBlock, Heading, Text } from "@littleorgans/ui/components/text";

import { TaskBoard } from "../tasks/task-board.js";
import type { WorkspaceView } from "./model.js";

/** The example workspace owns its diagnostics and product composition. */
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
              <CardTitle>Principal</CardTitle>
              <CardDescription>
                Verified identity claims for this session. <Code>orgId</Code> identifies the current
                organization; <Code>entitlements</Code> lists the features granted by the provider.
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
