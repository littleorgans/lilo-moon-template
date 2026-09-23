import { groupBy } from "@littleorgans/collections";
import { Badge } from "@littleorgans/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@littleorgans/ui/components/card";
import { Row, Stack } from "@littleorgans/ui/components/layout";
import { Text } from "@littleorgans/ui/components/text";

/** The demo product's data. The board is its only reader, so it lives beside the board. */
const TASKS = [
  { id: "scout", status: "done", title: "Scout baseline" },
  { id: "library", status: "done", title: "Library exemplar" },
  { id: "app", status: "todo", title: "Application exemplar" },
] as const;

/** The demo product itself, rendered inside the signed-in panel. */
export function TaskBoard() {
  const byStatus = groupBy(TASKS, (task) => task.status);

  return (
    <Stack gap="md">
      {[...byStatus].map(([status, tasks]) => (
        <Card key={status} data-status={status}>
          <CardHeader>
            <CardTitle>{status}</CardTitle>
          </CardHeader>
          <CardContent>
            <Stack gap="sm">
              {tasks.map((task) => (
                <Row key={task.id} justify="between">
                  <Text>{task.title}</Text>
                  <Badge variant={status === "done" ? "secondary" : "outline"}>{status}</Badge>
                </Row>
              ))}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}
