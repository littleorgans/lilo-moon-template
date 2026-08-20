import { groupBy } from "@lilo-moon/collections";

export const TASKS = [
  { id: "scout", status: "done", title: "Scout baseline" },
  { id: "library", status: "done", title: "Library exemplar" },
  { id: "app", status: "todo", title: "Application exemplar" },
] as const;

export function App() {
  const byStatus = groupBy(TASKS, (task) => task.status);

  return (
    <main>
      <h1>Task board</h1>
      {[...byStatus].map(([status, tasks]) => (
        <section key={status}>
          <h2>{status}</h2>
          <ul>
            {tasks.map((task) => (
              <li key={task.id}>{task.title}</li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
