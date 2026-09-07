import { SessionErrorPanel } from "@lilo-moon/views/session-error";
import { createFileRoute } from "@tanstack/react-router";

import { retrySearch } from "../search.js";

export const Route = createFileRoute("/session-error")({
  validateSearch: retrySearch,
  component: SessionError,
});

function SessionError() {
  const { retry } = Route.useSearch();
  return (
    <SessionErrorPanel
      supportHint="If this persists, quote the time you saw it."
      {...(retry ? { retryPath: "/app" } : {})}
    />
  );
}
