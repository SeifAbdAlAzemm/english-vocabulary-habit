import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { close, identity, identitySchema, insertWord, learnerA, learnerB, migrationSql, save, session, start, word } from "../helpers/database.mjs";

const execute = promisify(execFile);
async function run(file, args) {
  return execute(file, args, { windowsHide: true, timeout: 30000 });
}
async function postgresBin() {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const windowsBin = "C:/Program Files/PostgreSQL/17/bin";
  if (process.platform === "win32" && existsSync(join(windowsBin, "initdb.exe"))) return windowsBin;
  try { return (await run("pg_config", ["--bindir"])).stdout.trim(); }
  catch { throw new Error("Install native PostgreSQL 17+ and set PG_BIN to its bin directory to run the multi-connection tests."); }
}
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("real PostgreSQL connections serialize lifecycle and word-limit races", { timeout: 120000 }, async t => {
  const bin = await postgresBin();
  const executable = name => join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`);
  // Dedicated, ephemeral cluster, bound to loopback. No hosted URL or credentials.
  const root = await mkdtemp(join(tmpdir(), "vocabulary-habit-pg-test-"));
  const data = join(root, "data");
  const port = await freePort();
  const clients = new Set();
  let started = false;
  t.after(async () => {
    await Promise.allSettled([...clients].map(client => client.end()));
    if (started) await run(executable("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"]);
    // Check the resolved deletion target is exactly our freshly created temp child.
    const target = resolve(root);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("vocabulary-habit-pg-test-")) throw new Error("Unexpected PostgreSQL test cleanup path");
    await rm(target, { recursive: true, force: true });
  });
  await run(executable("initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "--encoding=UTF8", "--no-locale"]);
  await run(executable("pg_ctl"), ["-D", data, "-l", join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -F -c max_connections=12`, "-w", "start"]);
  started = true;
  async function connect(learner) {
    const client = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres", connectionTimeoutMillis: 5000, query_timeout: 10000 });
    clients.add(client); await client.connect();
    if (learner) await identity(client, learner);
    return client;
  }
  const admin = await connect();
  await admin.query(identitySchema);
  await admin.query(await migrationSql());
  await admin.query("insert into auth.users values ($1), ($2)", [learnerA, learnerB]);
  const a = await connect(learnerA);
  const b = await connect(learnerA);
  const bPid = (await b.query("select pg_backend_pid() as pid")).rows[0].pid;
  async function waitForBlocked() {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const result = await admin.query("select wait_event_type from pg_stat_activity where pid = $1", [bPid]);
      if (result.rows[0]?.wait_event_type === "Lock") return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("The competing connection did not block on a database lock");
  }
  function outcome(promise) { return promise.then(result => ({ result }), error => ({ error })); }
  async function fresh(chosen = 1) {
    await a.query("rollback"); await b.query("rollback");
    await admin.query("truncate auth.users cascade");
    await admin.query("insert into auth.users values ($1), ($2)", [learnerA, learnerB]);
    await identity(a, learnerA); await identity(b, learnerA);
    const id = await start(a);
    await a.query("update study_sessions set chosen_words = $1 where id = $2", [chosen, id]);
    return id;
  }
  const count = async id => (await a.query("select count(*)::int as n from words where session_id = $1", [id])).rows[0].n;

  await t.test("simultaneous starts return the same active draft", async () => {
    await admin.query("truncate auth.users cascade");
    await admin.query("insert into auth.users values ($1), ($2)", [learnerA, learnerB]);
    await a.query("begin");
    const first = await start(a);
    const competing = outcome(start(b));
    await waitForBlocked();
    await a.query("commit");
    const second = await competing;
    assert.ifError(second.error); assert.equal(second.result, first);
    assert.equal((await a.query("select count(*)::int as n from study_sessions")).rows[0].n, 1);
  });
  await t.test("start retries when the conflicting draft closes during its locked lookup", async () => {
    const previousId = await fresh(2);
    // B's INSERT sees the committed unique conflict, then its SELECT FOR UPDATE
    // must wait for A. A closes that row before releasing it, so B's lookup
    // no longer matches status='draft' and must retry the INSERT.
    await a.query("begin");
    await a.query("select id from study_sessions where id = $1 for update", [previousId]);
    const competing = outcome(start(b));
    await waitForBlocked();
    await close(a, await session(a, previousId));
    await a.query("commit");
    const next = await competing;
    assert.ifError(next.error);
    assert.match(next.result, /^[0-9a-f-]{36}$/);
    assert.notEqual(next.result, previousId);
    assert.equal((await session(a, previousId)).status, "closed_incomplete");
    assert.equal((await session(a, next.result)).status, "draft");
    assert.equal(await start(a), next.result);
    assert.equal((await a.query("select count(*)::int as n from study_sessions where status = 'draft'")).rows[0].n, 1);
    assert.equal((await a.query("select count(*)::int as n from study_sessions")).rows[0].n, 2);
  });
  await t.test("direct concurrent inserts competing for the last slot cannot exceed the selected count", async () => {
    const id = await fresh(1);
    await a.query("begin"); await insertWord(a, id, word("winner"));
    const competing = outcome(insertWord(b, id, word("loser")));
    await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.constraint, "session_word_limit");
    assert.equal(await count(id), 1);
  });
  await t.test("concurrent RPC retries insert only once, preserving the exact first sentence", async () => {
    const id = await fresh(1); const original = word();
    const version = (await session(a, id)).version;
    await a.query("begin"); await save(a, id, version, original);
    const competing = outcome(save(b, id, version, original));
    await waitForBlocked(); await a.query("commit");
    const retried = await competing;
    assert.ifError(retried.error); assert.equal(retried.result.rows[0].id, original.id);
    assert.equal(await count(id), 1);
    assert.equal((await a.query("select first_sentence from words")).rows[0].first_sentence, original.first_sentence);
  });
  await t.test("different RPC saves cannot use a stale version to bypass the last slot", async () => {
    const id = await fresh(1); const version = (await session(a, id)).version;
    await a.query("begin"); await save(a, id, version, word("winner"));
    const competing = outcome(save(b, id, version, word("loser")));
    await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.code, "40001");
    await assert.rejects(save(b, id, (await session(b, id)).version, word("retry-new-version")), e => e.constraint === "session_word_limit");
    assert.equal(await count(id), 1);
  });
  await t.test("a count reduction waits for the insert and rejects an invalid reduction", async () => {
    const id = await fresh(2); await insertWord(a, id, word("first"));
    await a.query("begin"); await insertWord(a, id, word("second"));
    const competing = outcome(b.query("update study_sessions set chosen_words = 1 where id = $1", [id]));
    await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.constraint, "session_word_limit");
    assert.equal((await session(a, id)).chosen_words, 2);
    assert.equal(await count(id), 2);
  });
  await t.test("an insert cannot race past closing; history remains unchanged", async () => {
    const id = await fresh(2); const snapshot = await session(a, id);
    await a.query("begin"); await close(a, snapshot);
    const competing = outcome(insertWord(b, id));
    await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.code, "42501");
    assert.equal((await session(a, id)).status, "closed_incomplete");
    assert.equal(await count(id), 0);
    assert.notEqual(await start(a), id);
  });
  await t.test("closing with a stale snapshot waits for the insert and fails without losing the word", async () => {
    const id = await fresh(2); const snapshot = await session(a, id);
    await a.query("begin"); await insertWord(a, id);
    const competing = outcome(close(b, snapshot));
    await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.code, "40001");
    assert.equal((await session(a, id)).status, "draft");
    assert.equal(await count(id), 1);
  });
  for (const isolation of ["repeatable read", "serializable"]) {
    await t.test(`${isolation} snapshots cannot bypass the count with a stale read`, async () => {
      const id = await fresh(1);
      await a.query(`begin isolation level ${isolation}`);
      assert.equal(await count(id), 0); // Establish A's snapshot before B commits.
      await insertWord(b, id, word("committed-first"));
      await assert.rejects(insertWord(a, id, word("stale-snapshot")), e => e.code === "40001");
      await a.query("rollback");
      assert.equal(await count(id), 1);
    });
  }

  async function reviewFixture() {
    const id = await fresh(1);
    const w = { ...word(), learn_date: "2000-01-02" };
    await save(a, id, (await session(a,id)).version, w);
    await close(a, await session(a,id));
    const sid = (await a.query("select start_practice_session('review','UTC',false) id")).rows[0].id;
    return { sid, wid: w.id, due: "2000-01-03", version: (await session(a,sid)).version };
  }
  function recall(client, f, id = randomUUID(), result = "forgot") {
    return client.query("select record_review($1,$2,$3,$4,$5,$6,null,'UTC','[]'::jsonb) id", [id,f.sid,f.version,f.wid,f.due,result]);
  }
  await t.test("concurrent first recalls return one immutable result and one next-day remedial", async () => {
    const f=await reviewFixture(); await a.query("begin");
    const first=(await recall(a,f)).rows[0].id;
    const competing=outcome(recall(b,f,randomUUID(),"remembered"));
    await waitForBlocked(); await a.query("commit");
    const retried=await competing; assert.ifError(retried.error); assert.equal(retried.result.rows[0].id,first);
    assert.equal((await a.query("select count(*)::int n from review_attempts")).rows[0].n,1);
    assert.equal((await a.query("select recall from review_attempts")).rows[0].recall,"forgot");
    assert.equal((await a.query("select count(*)::int n from review_obligations where kind='remedial'")).rows[0].n,1);
  });
  await t.test("review save wins against stale closing without losing the first result", async () => {
    const f=await reviewFixture(); const snapshot=await session(a,f.sid);
    await a.query("begin"); await recall(a,f);
    const competing=outcome(close(b,snapshot)); await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.code,"40001");
    assert.equal((await session(a,f.sid)).status,"draft");
    assert.equal((await a.query("select count(*)::int n from review_attempts")).rows[0].n,1);
  });
  await t.test("closing wins against a fresh recall; no evidence can leak into closed history", async () => {
    const f=await reviewFixture(); await a.query("begin"); await close(a,await session(a,f.sid));
    const competing=outcome(recall(b,f)); await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.code,"55000");
    assert.equal((await a.query("select count(*)::int n from review_attempts")).rows[0].n,0);
  });
  await t.test("concurrent Day +7 sentences preserve exactly the first version", async () => {
    const f={...await reviewFixture(),due:"2000-01-09"};
    const aid=(await recall(a,f,randomUUID(),"remembered")).rows[0].id;
    const version=(await session(a,f.sid)).version;
    const production=(client,text)=>client.query("select finish_review_feedback($1,$2,$3,$4,false,'UTC')",[aid,f.sid,version,text]);
    await a.query("begin"); await production(a,"  First independent sentence.  ");
    const competing=outcome(production(b,"Replacement")); await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.code,"40001");
    assert.equal((await a.query("select first_sentence from review_productions")).rows[0].first_sentence,"  First independent sentence.  ");
  });
  await t.test("final feedback and session completion serialize without awarding unchecked reviews", async () => {
    const f=await reviewFixture(); const ids=[];
    const obligations=(await a.query("select id,due_date::text due_date,checkpoint from review_obligations order by due_date")).rows;
    for(const o of obligations) {
      const aid=(await a.query("select record_review($1,$2,$3,$4,$5,'remembered',$6,'UTC','[]') id",[randomUUID(),f.sid,(await session(a,f.sid)).version,f.wid,o.due_date,o.checkpoint===7?'My independent sentence.':null])).rows[0].id;
      ids.push(aid); await a.query("select reveal_review_answer($1)",[aid]);
    }
    async function acknowledge(aid) {
      return a.query("select finish_review_feedback($1,$2,$3,null,true,'UTC')",[aid,f.sid,(await session(a,f.sid)).version]);
    }
    await acknowledge(ids[0]);
    const finish=(client,version)=>client.query("select complete_practice_session($1,$2,'[]')",[f.sid,version]);
    await assert.rejects(finish(a,(await session(a,f.sid)).version),e=>e.code==='23514');
    for(const aid of ids.slice(1,-1)) await acknowledge(aid);
    const staleVersion=(await session(a,f.sid)).version;
    await a.query("begin"); await acknowledge(ids.at(-1));
    const competing=outcome(finish(b,staleVersion));
    await waitForBlocked(); await a.query("commit");
    assert.equal((await competing).error?.code,"40001");
    assert.equal((await session(a,f.sid)).status,"draft");
    await finish(b,(await session(b,f.sid)).version);
    assert.equal((await session(a,f.sid)).status,"completed");
    assert.equal((await a.query("select count(*)::int n from review_schedule where completed")).rows[0].n,5);
  });
});
