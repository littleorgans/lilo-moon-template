import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

import { WorkOS } from "@workos-inc/node";
import { chromium } from "playwright-core";
import type { Browser } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from "vitest";

import {
  contractEmail,
  personalExternalId,
  removeUsers,
  requiredCredentials,
  stagingCredentials,
  sweepStale,
} from "../src/staging.js";

// One sign-in by email code, in a real browser, through the reference application's built server:
// the sign-in form, the code page, a refused code, the signed-in page, and sign-out.
//
// The code the browser types is not the one the application asked for. That one is emailed to an
// address on a reserved domain and never read. The test then asks the API for a fresh code for the
// same address, which supersedes the first, as a second "email me a code" would. Everything the
// application does is still exercised: it sends the first code, and verifies the second.

// contract/global-setup.ts says why when this is null.
const credentials = stagingCredentials();

const server = fileURLToPath(
  new URL("../../../apps/web/.output/server/index.mjs", import.meta.url),
);

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (typeof address === "object" && address !== null) resolve(address.port);
        else reject(new Error("no port"));
      });
    });
  });
}

async function until<T>(
  what: string,
  attempt: () => Promise<T | null>,
  deadline = Date.now() + 30_000,
): Promise<T> {
  const value = await attempt().catch(() => null);
  if (value !== null) return value;
  if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return await until(what, attempt, deadline);
}

describe.skipIf(credentials === null)("email-code sign-in through the reference app", () => {
  let admin: WorkOS;
  const email = contractEmail("browser");
  const created = new Set<string>();
  let output = "";
  let app: ChildProcess | undefined;
  let browser: Browser | undefined;
  let origin = "";

  // Built here rather than in the describe body, which runs even when the suite is skipped.
  beforeAll(async () => {
    const { apiKey, clientId } = requiredCredentials();
    admin = new WorkOS({ apiKey, clientId });
    if (!existsSync(server)) {
      throw new Error(`${server} is missing. Run it through moon, which builds it first.`);
    }
    await sweepStale(admin);
    origin = `http://localhost:${await freePort()}`;
    // Only what the server needs. No DATABASE_URL, so /app renders without a scoped transaction,
    // and a cookie password nobody else holds. The redirect URI only sets the origin POSTs must
    // come from: the email flow never sends the browser to it.
    app = spawn(process.execPath, [server], {
      env: {
        PATH: process.env["PATH"] ?? "",
        NODE_ENV: "production",
        PORT: new URL(origin).port,
        WORKOS_API_KEY: apiKey,
        WORKOS_CLIENT_ID: clientId,
        WORKOS_REDIRECT_URI: `${origin}/callback`,
        WORKOS_COOKIE_PASSWORD: randomBytes(32).toString("base64url"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const record = (chunk: Buffer) => {
      output = (output + chunk.toString())
        .replaceAll(apiKey, "[REDACTED]")
        .replaceAll(clientId, "[REDACTED]");
    };
    app.stdout?.on("data", record);
    app.stderr?.on("data", record);
    let exited = false;
    app.once("exit", () => {
      exited = true;
    });
    await until("the reference app to start", async () => {
      if (exited) throw new Error(`The reference app exited:\n${output}`);
      return (await fetch(`${origin}/`)).status === 200 ? true : null;
    }).catch((error: unknown) => {
      throw exited ? new Error(`The reference app exited:\n${output}`) : error;
    });
    browser = await chromium.launch();
  });

  afterAll(async () => {
    // Attempt provider cleanup even if closing the browser fails. Look up the unique address too:
    // the app may have created its user before navigation or the first test-side lookup failed.
    const cleanup = await Promise.allSettled([
      browser?.close(),
      (async () => {
        app?.kill();
        if (admin === undefined) return;
        try {
          const { data } = await admin.userManagement.listUsers({ email });
          for (const user of data) created.add(user.id);
        } finally {
          await removeUsers(admin, created);
        }
      })(),
    ]);
    const failures = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) throw new AggregateError(failures, "Browser contract cleanup failed.");
  });

  it("signs in with a code, lands in the workspace with a personal organization, and signs out", async () => {
    onTestFailed(() => {
      console.error(`Reference app output:\n${output}`);
    });
    if (browser === undefined) throw new Error("beforeAll did not finish");
    const page = await browser.newPage();

    await page.goto(`${origin}/`);
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in code" }).click();
    await page.waitForURL(`${origin}/verify-email`);

    const [user] = (await admin.userManagement.listUsers({ email })).data;
    if (user === undefined) throw new Error(`the provider has no user for ${email}`);
    created.add(user.id);
    const { code } = await admin.userManagement.createMagicAuth({ email });

    const codeField = page.getByLabel("Six-digit code");
    const submit = page.getByRole("button", { name: "Sign in" });
    await codeField.fill(code === "000000" ? "111111" : "000000");
    await submit.click();
    await page.waitForURL(`${origin}/verify-email?retry=true`);
    await expect.poll(() => page.locator('[data-status="retry"]').count()).toBe(1);

    await codeField.fill(code);
    await submit.click();
    await page.waitForURL(`${origin}/app`);

    const organization = await admin.organizations.getOrganizationByExternalId(
      personalExternalId(user.id),
    );
    await expect.poll(() => page.getByRole("heading", { name: "Signed in" }).count()).toBe(1);
    await expect.poll(() => page.getByText(user.id, { exact: true }).count()).toBe(1);
    await expect.poll(() => page.getByText(organization.id, { exact: true }).count()).toBe(1);

    const sessionBefore = (await admin.userManagement.listSessions(user.id)).data.find(
      (session) => session.status === "active",
    );
    expect(sessionBefore).toBeDefined();

    // Sign-out sends the browser to the provider's logout URL for this session, which ends it.
    const logout = page.waitForRequest((request) =>
      request.url().startsWith("https://api.workos.com/user_management/sessions/logout"),
    );
    await page.getByRole("button", { name: "Sign out" }).click();
    expect(new URL((await logout).url()).searchParams.get("session_id")).toBe(sessionBefore?.id);
    await until("the provider session to end", async () => {
      const { data } = await admin.userManagement.listSessions(user.id);
      return data.some((session) => session.status === "active") ? null : true;
    });

    // And the application's own cookie is gone: the workspace sends the browser to sign in.
    await page.goto(`${origin}/app`);
    await page.waitForURL(`${origin}/`);
  });
});
