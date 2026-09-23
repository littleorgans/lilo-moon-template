import { SessionErrorPanel } from "@littleorgans/views/session-error";
import { createFileRoute } from "@tanstack/react-router";

import { retrySearch } from "../../features/auth/search.js";

export const Route = createFileRoute("/(auth)/session-error")({
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
