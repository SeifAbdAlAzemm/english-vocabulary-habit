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
import { word as fixtureWord } from "../helpers/database.mjs";

const execute = promisify(execFile);
const origin = "http://localhost:3001";
const runtimeProblem = /encountered.*unstable|uncached data|blocking-prerender-(current-time|dynamic)|next-prerender-current-time|blocked cross-origin|hydration.*failed/i;

test("authenticated runtime, local calendar, Review and MVD", { timeout: 420000 }, async t => {
  const config = await localSupabaseConfig(); // Loopback-only; hosted configuration is rejected.
  const email = `runtime-${randomUUID()}@example.test`;
  const password = `Aa9!${randomUUID()}`;
  const redact = value => [config.adminKey, config.key, email, password].reduce((text, secret) => text.split(secret).join("[redacted]"), String(value));
  const admin = createClient(config.url, config.adminKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Unable to create an isolated local Auth test learner: ${redact(created.error?.message ?? "no user returned")} (status ${created.error?.status ?? "unknown"}).`);
  const userId = created.data.user.id;
  const temporaryUsers = [userId];
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
    for (const id of temporaryUsers) {
      const result = await admin.auth.admin.deleteUser(id);
      if (result.error) throw new Error(`Could not remove a temporary local Auth learner: ${redact(result.error.message)}`);
    }
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

  async function withLearner(timezoneId, time, check, installClock = false, credentials = { email, password }) {
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
      await page.getByLabel("Email address").fill(credentials.email);
      await page.getByLabel("Password", { exact: true }).fill(credentials.password);
      await page.getByRole("button", { name: "Sign in →", exact: true }).click();
      await expect(page.getByRole("heading", { name: /Small steps/ })).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole("button", { name: /^(Start Your Routine Today|Resume your draft) →$/ })).toBeEnabled();
      await expect(page.locator("#main").getByRole("alert")).toHaveCount(0);
      await check(page);
      await expect.poll(() => hmrMessages > 0, { timeout: 10000 }).toBe(true);
      const problems = [...new Set(browserProblems.slice(initialProblems))];
      assert.equal(problems.length, 0, `Browser runtime errors: ${problems.join("\n")}`);
    } catch (error) {
      throw new Error(redact(`${error.stack ?? error}\nUI: ${(await page.locator("#main").innerText().catch(()=>"unavailable")).slice(0,6000)}`));
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

  async function practiceLearner(days, count = 1) {
    const credentials = { email: `slice02-${randomUUID()}@example.test`, password: `Aa9!${randomUUID()}` };
    const created = await admin.auth.admin.createUser({ ...credentials, email_confirm: true });
    assert.ifError(created.error); temporaryUsers.push(created.data.user.id);
    const client = createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.ifError((await client.auth.signInWithPassword(credentials)).error);
    async function rpc(name,args) { const r=await client.rpc(name,args); assert.ifError(r.error); return r.data; }
    const today = await rpc("learner_today",{p_timezone:"UTC"});
    if (days !== null) {
      const d=new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-days);
      const date=d.toISOString().slice(0,10);
      const sid=await rpc("start_study_session",{p_local_date:date,p_exceptional:true});
      assert.ifError((await client.from("study_sessions").update({chosen_words:3}).eq("id",sid)).error);
      for(let i=0;i<count;i++) {
        const s=(await client.from("study_sessions").select("*").eq("id",sid).single()).data;
        await rpc("save_session_word",{p_session_id:sid,p_version:s.version,p_word:{...fixtureWord(i===0?"analysis":`approach-${i}`),learn_date:date,meaning:"Private review meaning",source_example:"Private source example"},p_intervals:[]});
      }
      const s=(await client.from("study_sessions").select("*").eq("id",sid).single()).data;
      await rpc("close_study_session",{p_session_id:sid,p_version:s.version,p_draft:s.draft,p_intervals:[],p_chosen_words:3,p_exceptional:true});
    }
    return { credentials, client, today };
  }
  async function revealAndCheck(page) {
    await page.getByRole("button",{name:"Reveal saved answer",exact:true}).click();
    await expect(page.getByTestId("review-meaning")).toHaveText("Private review meaning");
    await page.getByRole("button",{name:"I checked the answer and corrected mistakes",exact:true}).click();
  }
  await t.test("first-day MVD: recover original sentence, save one word, finish and retain history", async()=> {
    const f=await practiceLearner(null);
    await withLearner("UTC",new Date().toISOString(),async page=> {
      await page.getByRole("button",{name:"Start MVD →",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Minimum Viable Day",exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:"Finish MVD",exact:true})).toBeDisabled();
      const timer=page.getByRole("timer"); const before=await timer.textContent();
      await expect(timer).not.toHaveText(before);
      await page.getByRole("button",{name:"Pause stopwatch",exact:true}).click();
      const paused=await timer.textContent(); await page.waitForTimeout(1200); await expect(timer).toHaveText(paused);
      await page.getByLabel("Target word",{exact:true}).fill("analysis");
      await page.getByLabel("Primary meaning",{exact:true}).fill("My own saved meaning");
      await page.getByLabel("One source example",{exact:true}).fill("One real source example.");
      await page.getByRole("button",{name:"Hide notes & write my sentence →",exact:true}).click();
      const sentence="  My analysis have mistakes.\nI preserve this original.  ";
      await page.getByLabel("My first sentence",{exact:true}).fill(sentence);
      await page.reload();
      await expect(page.getByRole("button",{name:"Resume stopwatch",exact:true})).toBeEnabled();
      const restore=page.getByRole("button",{name:"Restore local work",exact:true}); if(await restore.isVisible()) await restore.click();
      await expect(page.getByLabel("My first sentence",{exact:true})).toHaveValue(sentence);
      await page.getByRole("button",{name:"Save word to My Words →",exact:true}).click();
      await expect(page.getByRole("heading",{name:"analysis",exact:true})).toBeVisible();
      expect(await page.locator(".sentence-evidence .preserved-text").textContent()).toBe(sentence);
      await page.getByRole("link",{name:"Continue draft →",exact:true}).click();
      await page.getByRole("button",{name:"Finish MVD",exact:true}).click();
      await expect(page.getByText("Practice completed",{exact:true})).toBeVisible();
      assert.equal((await f.client.from("review_obligations").select("id")).data.length,5);
      await page.reload(); await expect(page.getByText("Practice completed",{exact:true})).toBeVisible();
      await page.getByRole("button",{name:"Sign out",exact:true}).click();
      await page.getByLabel("Email address").fill(f.credentials.email);
      await page.getByLabel("Password",{exact:true}).fill(f.credentials.password);
      await page.getByRole("button",{name:"Sign in →",exact:true}).click();
      await page.getByRole("link",{name:"My Words",exact:true}).click();
      expect(await page.locator(".sentence-evidence .preserved-text").textContent()).toBe(sentence);
    },false,f.credentials);
  });
  await t.test("extra MVD: new independent sentence precedes reveal and qualifies without milestone results",async()=> {
    const f=await practiceLearner(0);
    await withLearner("UTC",new Date().toISOString(),async page=> {
      await page.getByRole("button",{name:"Start MVD →",exact:true}).click();
      const sentence=page.getByLabel(/New independent sentence/);
      await sentence.fill("  My fresh analysis explains our next step.  ");
      await expect(page.getByTestId("review-meaning")).toHaveCount(0);
      await page.getByRole("button",{name:"Remembered",exact:true}).click();
      await expect(page.getByRole("button",{name:"Reveal saved answer",exact:true})).toBeVisible();
      await page.reload();
      const restore=page.getByRole("button",{name:"Keep cloud copy",exact:true}); if(await restore.isVisible()) await restore.click();
      await revealAndCheck(page);
      await page.getByRole("button",{name:"Finish MVD",exact:true}).click();
      await expect(page.getByText("Practice completed",{exact:true})).toBeVisible();
      const attempts=(await f.client.from("review_attempts").select("*")).data;
      assert.equal(attempts.length,1); assert.equal(attempts[0].scheduled_date,null);
    },false,f.credentials);
  });
  await t.test("due MVD tests two distinct words, schedules remedial and leaves backlog due",async()=> {
    const f=await practiceLearner(7,3);
    await withLearner("UTC",new Date().toISOString(),async page=> {
      await page.getByRole("link",{name:"Review",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Review your words",exact:true})).toBeVisible();
      await page.getByRole("button",{name:"Start MVD →",exact:true}).click();
      await page.getByRole("button",{name:"Forgot",exact:true}).click(); await revealAndCheck(page);
      await expect(page.getByRole("button",{name:"Finish MVD",exact:true})).toBeDisabled();
      await page.getByRole("button",{name:"Remembered",exact:true}).click(); await revealAndCheck(page);
      await page.getByRole("button",{name:"Finish MVD",exact:true}).click();
      await expect(page.getByText("Practice completed",{exact:true})).toBeVisible();
      const attempts=(await f.client.from("review_attempts").select("*")).data;
      assert.equal(new Set(attempts.map(a=>a.word_id)).size,2);
      assert.ok(attempts.every(a=>a.was_late));
      assert.equal((await f.client.from("review_obligations").select("id").eq("kind","remedial")).data.length,1);
      assert.equal((await f.client.from("review_schedule").select("id").lte("due_date",f.today).eq("completed",false)).data.length,7);
    },false,f.credentials);
  });
  await t.test("multi-word recalls with only one checked answer remain due and cannot complete",async()=> {
    const f=await practiceLearner(1,3);
    async function rpc(name,args) { const result=await f.client.rpc(name,args); assert.ifError(result.error); return result.data; }
    const sid=await rpc("start_practice_session",{p_mode:"review",p_timezone:"UTC",p_exceptional:false});
    const version=async()=> (await f.client.from("study_sessions").select("version").eq("id",sid).single()).data.version;
    const words=(await f.client.from("words").select("id").order("target")).data;
    const ids=[];
    for(const w of words) ids.push(await rpc("record_review",{p_id:randomUUID(),p_session_id:sid,p_version:await version(),p_word_id:w.id,p_scheduled_date:f.today,p_recall:"remembered",p_sentence:null,p_timezone:"UTC",p_intervals:[]}));
    await rpc("reveal_review_answer",{p_attempt_id:ids[0]});
    await rpc("finish_review_feedback",{p_attempt_id:ids[0],p_session_id:sid,p_version:await version(),p_sentence:null,p_acknowledge:true,p_timezone:"UTC"});
    const rejection=await f.client.rpc("complete_practice_session",{p_session_id:sid,p_version:await version(),p_intervals:[]});
    assert.equal(rejection.error?.code,"23514");
    await withLearner("UTC",new Date().toISOString(),async page=> {
      await page.getByRole("button",{name:"Resume your draft →",exact:true}).click();
      const finish=page.getByRole("button",{name:"Finish review session",exact:true});
      await expect(finish).toBeDisabled();
      await expect(page.getByText(/^2 due cards remaining/)).toBeVisible();
      const before=(await f.client.from("review_schedule").select("completed,milestone_metric_eligible").lte("due_date",f.today)).data;
      assert.equal(before.filter(r=>r.completed).length,1); assert.equal(before.filter(r=>r.milestone_metric_eligible).length,1);
      await revealAndCheck(page);
      await expect(finish).toBeDisabled();
      // A click resolves before the Server Action; wait for persisted queue
      // state before intentionally interrupting the page with a reload.
      await expect(page.getByText(/^1 due cards remaining/)).toBeVisible();
      await page.reload();
      await expect(page.getByRole("button",{name:"Resume stopwatch",exact:true})).toBeEnabled();
      const keepCloud=page.getByRole("button",{name:"Keep cloud copy",exact:true}); if(await keepCloud.isVisible()) await keepCloud.click();
      await expect(page.getByText(/^1 due cards remaining/)).toBeVisible();
      await revealAndCheck(page);
      await expect(finish).toBeEnabled(); await finish.click();
      await expect(page.getByText("Practice completed",{exact:true})).toBeVisible();
      assert.equal((await f.client.from("review_attempts").select("id")).data.length,3);
    },false,f.credentials);
  });
  await t.test("review-only: Day +7 sentence survives reload before reveal and stays ungraded",async()=> {
    const f=await practiceLearner(7);
    await withLearner("UTC",new Date().toISOString(),async page=> {
      await page.getByRole("link",{name:"Review",exact:true}).click();
      await page.getByRole("button",{name:"Start review session →",exact:true}).click();
      for(let i=0;i<2;i++) { await page.getByRole("button",{name:"Remembered",exact:true}).click(); await revealAndCheck(page); }
      await expect(page.getByRole("button",{name:"Remembered",exact:true})).toBeDisabled();
      const original="  This independent analysis reflects a new situation.  ";
      await page.getByLabel(/New independent sentence/).fill(original);
      await page.reload();
      const restore=page.getByRole("button",{name:"Restore local work",exact:true}); if(await restore.isVisible()) await restore.click();
      await expect(page.getByLabel(/New independent sentence/)).toHaveValue(original);
      await expect(page.getByTestId("review-meaning")).toHaveCount(0);
      await page.getByRole("button",{name:"Remembered",exact:true}).click();
      await expect(page.getByText(/Pending evaluation \(no score assigned\)/)).toBeVisible();
      await revealAndCheck(page);
      await page.getByRole("button",{name:"Do additional Extra Practice",exact:true}).click();
      await page.getByRole("button",{name:"Forgot",exact:true}).click(); await revealAndCheck(page);
      await page.getByRole("button",{name:"Finish review session",exact:true}).click();
      await expect(page.getByText("Practice completed",{exact:true})).toBeVisible();
      const production=(await f.client.from("review_productions").select("*")).data[0];
      assert.equal(production.first_sentence,original); assert.equal(production.evaluation_state,"pending_evaluation");
      const results=(await f.client.from("review_attempts").select("*").not("scheduled_date","is",null)).data;
      assert.equal(results.length,3); assert.ok(results.every(a=>a.recall==='remembered'));
    },false,f.credentials);
  });
  await t.test("regular learning must review due words before new-word entry and stays unfinished",async()=> {
    const f=await practiceLearner(1);
    await withLearner("UTC",new Date().toISOString(),async page=> {
      const exceptional=page.getByLabel("I choose exceptional new-word study today."); if(await exceptional.isVisible()) await exceptional.check();
      await page.getByRole("button",{name:"Start Your Routine Today →",exact:true}).click();
      await expect(page.getByRole("button",{name:"Remembered",exact:true})).toBeVisible();
      await expect(page.getByLabel("Target word",{exact:true})).toHaveCount(0);
      await page.getByRole("button",{name:"Remembered",exact:true}).click(); await revealAndCheck(page);
      await expect(page.getByLabel("Target word",{exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:"Finish review session",exact:true})).toHaveCount(0);
      await page.getByRole("button",{name:"Close unfinished session",exact:true}).click();
      await page.getByRole("button",{name:"Close & keep history",exact:true}).click();
      await expect(page.getByText("Closed unfinished",{exact:true})).toHaveCount(2);
    },false,f.credentials);
  });
  const diagnostics = serverLogs.split("\n").filter(line => runtimeProblem.test(line));
  assert.equal(diagnostics.length, 0, `Development runtime diagnostics: ${redact(diagnostics.join("\n"))}`);
});
