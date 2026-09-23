import { SignInPanel } from "@littleorgans/views/sign-in";
import { createFileRoute } from "@tanstack/react-router";

import { PRODUCT } from "../server/product.js";

export const Route = createFileRoute("/")({
  // The signed-in loader sends a token that stopped verifying here with ?ended=true. The validated
  // value has to round-trip to what the URL parses to, or the router loops on normalising it
  // instead of rendering, so the key is omitted rather than false when absent.
  validateSearch: (search: Record<string, unknown>): { readonly ended?: true } =>
    search["ended"] === true ? { ended: true } : {},
  component: SignIn,
});

function SignIn() {
  const { ended } = Route.useSearch();
  return (
    <SignInPanel
      title={PRODUCT.name}
      description={PRODUCT.signIn.description}
      oauthLabel={PRODUCT.signIn.oauthLabel}
      oauthStartPath="/api/auth/start"
      emailStartPath="/api/auth/email/start"
      sessionEnded={ended === true}
    />
  );
}
