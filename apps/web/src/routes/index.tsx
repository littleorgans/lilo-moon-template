import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: SignIn,
});

/**
 * The signed-out page.
 *
 * Sign-in is an anchor to a server route, not a fetch. The route has to set the `state` cookie and
 * then hand the browser to the provider, and both of those are things a top-level navigation does
 * and an XHR does not.
 */
function SignIn() {
  return (
    <main>
      <h1>Task board</h1>
      <p>
        <a href="/api/auth/start">Continue with Google</a>
      </p>
      <p>
        <small>
          Unstyled on purpose. This is the auth path being proven, not the product. Themes and
          components come after.
        </small>
      </p>
    </main>
  );
}
