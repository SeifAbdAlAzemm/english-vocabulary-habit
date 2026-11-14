import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { chromium, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { localSupabaseConfig } from "../helpers/local-supabase.mjs";

const execute = promisify(execFile);
const origin = "http://localhost:3001";
const runtimeProblem = /encountered.*unstable|uncached data|blocking-prerender-(current-time|dynamic)|next-prerender-current-time|blocked cross-origin|hydration.*failed/i;

test("authenticated Dashboard prerender, local calendar and development origin", { timeout: 180000 }, async t => {
  const config = await localSupabaseConfig(); // Loopback-only; hosted configuration is rejected.
  const email = `runtime-${randomUUID()}@example.test`;
  const password = `Aa9!${randomUUID()}`;
  const redact = value => [config.adminKey, config.key, email, password].reduce((text, secret) => text.split(secret).join("[redacted]"), String(value));
  const admin = createClient(config.url, config.adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Unable to create an isolated local Auth test learner: ${redact(created.error?.message ?? "no user returned")} (status ${created.error?.status ?? "unknown"}).`);
  const userId = created.data.user.id;
  let browser;
  let server;
  let serverLogs = "";
  let spawnError = false;
  const browserProblems = [];
  t.after(async () => {
    await browser?.close();
    if (server && server.exitCode === null) {
      if (process.platform === "win32") {
        // Only the process tree launched by this test is stopped.
        await execute("taskkill", ["/pid", String(server.pid), "/t", "/f"], { windowsHide: true });
      } else {
        const exited = once(server, "exit");
        server.kill("SIGTERM"); await exited;
      }
    }
    const result = await admin.auth.admin.deleteUser(userId);
    if (result.error) throw new Error("Could not remove the temporary local Auth learner.");
  });

  // Never reuse a dev server whose environment could point at the hosted project.
  try {
    await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) });
    throw new Error("Port 3001 is already in use. Stop that test server before running runtime checks.");
  } catch (error) {
    if (error.message.includes("already in use")) throw error;
  }
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--hostname", "localhost", "--port", "3001"], {
    windowsHide: true,
    env: { ...process.env, VOCABULARY_RUNTIME_TEST: "1", NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.key },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = value => { serverLogs = (serverLogs + value.toString()).slice(-1000000); };
  server.stdout.on("data", collect); server.stderr.on("data", collect);
  server.on("error", () => { spawnError = true; });
  const deadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < deadline) {
    if (spawnError || server.exitCode !== null) throw new Error("The isolated Next.js runtime test server failed to start.");
    try {
      const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Wait for Next.js compilation. */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, "The isolated localhost test server did not become ready.");
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined) });

  async function withLearner(timezoneId, time, check, installClock = false) {
    const context = await browser.newContext({ baseURL: origin, timezoneId });
    const page = await context.newPage();
    let hmrMessages = 0;
    const initialProblems = browserProblems.length;
    page.on("pageerror", error => browserProblems.push(redact(error.message.split("\n")[0])));
    page.on("console", message => { if (runtimeProblem.test(message.text())) browserProblems.push(redact(message.text().split("\n")[0])); });
    page.on("websocket", socket => {
      if (new URL(socket.url()).pathname.includes("/_next/hmr")) {
        assert.equal(new URL(socket.url()).hostname, "localhost");
        socket.on("framereceived", () => hmrMessages++);
        socket.on("socketerror", () => browserProblems.push("The localhost HMR websocket failed."));
      }
    });
    try {
      if (installClock) await page.clock.install({ time: new Date(time) });
      else await page.clock.setFixedTime(new Date(time));
      await page.goto("/login");
      await page.getByLabel("Email address").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in →", exact: true }).click();
      await expect(page.getByRole("heading", { name: /Small steps/ })).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole("button", { name: "Start Your Routine Today →", exact: true })).toBeEnabled();
      await expect(page.locator("#main").getByRole("alert")).toHaveCount(0);
      await check(page);
      await expect.poll(() => hmrMessages > 0, { timeout: 10000 }).toBe(true);
      const problems = [...new Set(browserProblems.slice(initialProblems))];
      assert.equal(problems.length, 0, `Browser runtime errors: ${problems.join("\n")}`);
    } catch (error) {
      throw new Error(redact(error.stack ?? error));
    } finally { await context.close(); }
  }

  await t.test("real password sign-in and Dashboard reload render without current-time or HMR errors", async () => {
    await withLearner("Africa/Cairo", "2026-11-12T21:30:00Z", async page => {
      await expect(page.getByLabel("I choose exceptional new-word study today.")).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { name: /Small steps/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start Your Routine Today →", exact: true })).toBeEnabled();
      await expect(page.getByLabel("I choose exceptional new-word study today.")).toHaveCount(0);
      await page.getByRole("link", { name: "My Words", exact: true }).click();
      await expect(page.getByRole("heading", { name: "My Words", exact: true })).toBeVisible();
      await expect(page.locator("#main").getByRole("alert")).toHaveCount(0);
      await page.getByRole("link", { name: "Continue draft →", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Your learning session", exact: true })).toBeVisible();
      await expect(page.locator("#main").getByRole("alert")).toHaveCount(0);
      await page.getByRole("link", { name: "Dashboard", exact: true }).click();
      await expect(page.getByRole("heading", { name: /Small steps/ })).toBeVisible();
    });
  });
  await t.test("Cairo transitions to review on Friday and learning on Sunday, without carrying a day exception", async () => {
    await withLearner("Africa/Cairo", "2026-11-12T21:59:40Z", async page => {
      const exception = page.getByLabel("I choose exceptional new-word study today.");
      await expect(exception).toHaveCount(0);
      await page.clock.setSystemTime(new Date("2026-11-12T21:59:59Z"));
      await page.clock.fastForward(31000);
      await expect(exception).toBeVisible();
      await exception.check();
      await page.clock.setSystemTime(new Date("2026-11-14T12:00:00Z"));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(exception).not.toBeChecked();
      await page.clock.setSystemTime(new Date("2026-11-14T21:59:59Z"));
      await page.clock.fastForward(31000);
      await expect(exception).toHaveCount(0);
    }, true);
  });
  await t.test("Los Angeles uses its own weekday when UTC or Cairo is on another date", async () => {
    await withLearner("America/Los_Angeles", "2026-11-12T22:00:00Z", async page => {
      const exception = page.getByLabel("I choose exceptional new-word study today.");
      await expect(exception).toHaveCount(0);
      await page.clock.setFixedTime(new Date("2026-11-15T00:30:00Z"));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(exception).toBeVisible();
    });
  });
  const diagnostics = serverLogs.split("\n").filter(line => runtimeProblem.test(line));
  assert.equal(diagnostics.length, 0, `Development runtime diagnostics: ${redact(diagnostics.join("\n"))}`);
});
