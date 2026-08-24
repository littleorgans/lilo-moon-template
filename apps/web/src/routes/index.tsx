import { SignInPanel } from "@lilo-moon/views/sign-in";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: SignIn,
});

function SignIn() {
  return (
    <SignInPanel
      title="Task board"
      description="Sign in to see the tasks your workspace can see."
      oauthStartPath="/api/auth/start"
      emailStartPath="/api/auth/email/start"
    />
  );
}
