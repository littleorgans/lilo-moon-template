import { SKIP_MESSAGE, stagingCredentials } from "../src/staging.js";

// Runs once, in the main process. Vitest does not print what a test file logs when every test in it
// skipped, so the reason for skipping is printed here. A required run with no credentials fails here
// too, before any file is collected.
export default function announce(): void {
  if (stagingCredentials() === null) process.stdout.write(`\n${SKIP_MESSAGE}\n\n`);
}
