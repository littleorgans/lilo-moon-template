#!/usr/bin/env node
// Committed rather than built, so a package manager can link the bin before dist exists. The
// command line lives in src/commands.ts.
import { main } from "../dist/commands.js";

process.exitCode = await main(process.argv.slice(2), {
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
