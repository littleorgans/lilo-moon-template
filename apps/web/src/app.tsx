import { groupBy } from "@lilo-moon/collections";
import { Badge } from "@lilo-moon/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@lilo-moon/ui/components/card";
import { Row, Stack } from "@lilo-moon/ui/components/layout";
import { Text } from "@lilo-moon/ui/components/text";

export const TASKS = [
  { id: "scout", status: "done", title: "Scout baseline" },
  { id: "library", status: "done", title: "Library exemplar" },
  { id: "app", status: "todo", title: "Application exemplar" },
] as const;

export function App() {
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
