import { VerifyCodePanel } from "@lilo-moon/views/verify-code";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/verify-email")({
  // The verify handler appends ?retry=true when a code is refused. The validated value must
  // round-trip to exactly what the URL parses to: the router writes it back into the address, and
  // any difference restarts that normalisation instead of rendering. The same rule makes the key
  // optional rather than false when absent.
  validateSearch: (search: Record<string, unknown>): { readonly retry?: true } =>
    search["retry"] === true ? { retry: true } : {},
  component: VerifyEmail,
});

function VerifyEmail() {
  const { retry } = Route.useSearch();
  return (
    <VerifyCodePanel verifyPath="/api/auth/email/verify" startOverPath="/" retry={retry === true} />
  );
}
