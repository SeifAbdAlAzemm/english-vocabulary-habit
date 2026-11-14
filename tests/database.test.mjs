import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { close, identity, identitySchema, insertWord, intervals, learnerA, learnerB, migrationSql, save, session, start, word } from "./helpers/database.mjs";

// The actual migration runs in PostgreSQL WASM; only Supabase identity primitives
// are simulated. Separate native-Postgres tests exercise simultaneous connections.
test("session lifecycle, database limits, immutable evidence and account isolation", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(identitySchema);
  await db.exec(await migrationSql());
  let id;
  t.beforeEach(async () => {
    await db.exec("reset role; truncate auth.users cascade;");
    await db.query("insert into auth.users values ($1), ($2)", [learnerA, learnerB]);
    await identity(db, learnerA);
    id = await start(db);
  });
  const current = () => session(db, id);
  const wordCount = async () => (await db.query("select count(*)::int as n from words")).rows[0].n;
  const limitError = e => e.code === "23514" && e.constraint === "session_word_limit";

  await t.test("start returns a new owned UUID and recovers an existing draft without rewriting it", async () => {
    assert.match(id, /^[0-9a-f-]{36}$/);
    const created = await current();
    assert.equal(created.user_id, learnerA);
    assert.equal(created.status, "draft");
    assert.equal(created.version, 0);
    const draft = { ...word(), stage: "sentence" };
    await db.query("update study_sessions set draft = $1::jsonb, intervals = $2::jsonb where id = $3", [JSON.stringify(draft), JSON.stringify(intervals), id]);
    const before = await current();
    assert.equal(await start(db), id);
    assert.deepEqual(await current(), before);
    await assert.rejects(db.query("insert into study_sessions(local_date, session_type) values ('2026-11-15', 'learning')"), e => e.code === "23505");
    assert.equal((await db.query("select count(*)::int as n from study_sessions where status = 'draft'")).rows[0].n, 1);
  });
  await t.test("start rejects missing identity or settings rather than returning an undefined session", async () => {
    await assert.rejects(db.query("select start_study_session(null, false)"), e => e.code === "23514");
    await assert.rejects(db.query("select start_study_session('2026-11-15', null)"), e => e.code === "23514");
    await identity(db, "");
    await assert.rejects(start(db), e => e.code === "42501");
    await identity(db, learnerA);
    assert.equal((await current()).status, "draft");
    assert.equal((await db.query("select count(*)::int as n from study_sessions")).rows[0].n, 1);
  });
  await t.test("multiple historical sessions retain words, exact drafts and timing alongside one new draft", async () => {
    const firstWord = word();
    await save(db, id, (await current()).version, firstWord);
    const draft = { ...word("approach"), stage: "sentence", first_sentence: "  An unfinished original.\n  " };
    const before = await current();
    await close(db, before, draft, intervals);
    const closed = await current();
    assert.equal(closed.status, "closed_incomplete");
    assert.ok(closed.closed_at);
    assert.deepEqual(closed.draft, draft);
    assert.deepEqual(closed.intervals, intervals);
    assert.equal((await db.query("select first_sentence, session_id from words")).rows[0].first_sentence, firstWord.first_sentence);
    assert.equal((await db.query("select session_id from words")).rows[0].session_id, id);
    assert.equal((await close(db, before, draft, intervals)).rows[0].id, id);
    await assert.rejects(close(db, before, { ...draft, first_sentence: "Changed after the response was lost" }, intervals), e => e.code === "55000");
    const second = await start(db);
    assert.notEqual(second, id);
    await close(db, await session(db, second));
    const third = await start(db);
    assert.notEqual(third, second);
    assert.equal((await db.query("select count(*)::int as n from study_sessions")).rows[0].n, 3);
    assert.equal((await db.query("select count(*)::int as n from study_sessions where status = 'draft'")).rows[0].n, 1);
    assert.equal(await wordCount(), 1);
  });
  await t.test("draft fields and intervals recover; stale closing cannot overwrite newer work", async () => {
    const original = await current();
    const draft = { ...word(), stage: "sentence" };
    await db.query("update study_sessions set draft = $1::jsonb, intervals = $2::jsonb where id = $3", [JSON.stringify(draft), JSON.stringify(intervals), id]);
    const recovered = JSON.parse(JSON.stringify(await current()));
    assert.equal(recovered.status, "draft");
    assert.deepEqual(recovered.draft, draft);
    assert.deepEqual(recovered.intervals, intervals);
    assert.equal(recovered.intervals.reduce((n, i) => n + i.end - i.start, 0), 3000);
    await assert.rejects(close(db, original), e => e.code === "40001");
    assert.equal((await current()).status, "draft");
    await close(db, await current());
    await assert.rejects(db.query("update study_sessions set draft = '{}' where id = $1", [id]), e => e.code === "55000");
    await assert.rejects(db.query("update study_sessions set status = 'draft', closed_at = null where id = $1", [id]), e => e.code === "55000");
    await assert.rejects(insertWord(db, id, word("new-after-close")), e => e.code === "42501");
  });
  await t.test("null or negative versions cannot bypass save/close concurrency checks", async () => {
    const original = await current();
    for (const version of [null, -1]) {
      await assert.rejects(save(db, id, version, word()), e => e.code === "23514");
      await assert.rejects(close(db, { ...original, version }), e => e.code === "23514");
    }
    assert.equal((await current()).status, "draft");
    assert.equal(await wordCount(), 0);
  });
  await t.test("selected count is not completion evidence, even when every selected word is saved", async () => {
    await db.query("update study_sessions set chosen_words = 1 where id = $1", [id]);
    await insertWord(db, id);
    await assert.rejects(db.query("update study_sessions set status = 'completed', closed_at = now() where id = $1", [id]), e => e.code === "23514");
    await assert.rejects(db.query("insert into study_sessions(local_date, session_type, status, closed_at) values ('2026-11-15', 'learning', 'completed', now())"), e => e.code === "23514");
    await assert.rejects(db.query("insert into study_sessions(local_date, session_type, status, closed_at) values ('2026-11-15', 'learning', 'closed_incomplete', now())"), e => e.code === "23514");
    await close(db, await current());
    await assert.rejects(db.query("update study_sessions set status = 'completed' where id = $1", [id]), e => e.code === "23514");
    assert.equal((await current()).status, "closed_incomplete");
  });
  await t.test("RPC limit holds and retries at the limit or after closing return immutable original evidence", async () => {
    await db.query("update study_sessions set chosen_words = 1 where id = $1", [id]);
    const first = word();
    const version = (await current()).version;
    await save(db, id, version, first);
    await assert.rejects(save(db, id, (await current()).version, word("approach")), limitError);
    await assert.rejects(insertWord(db, id, word("direct-bypass")), limitError);
    const latestVersion = (await current()).version;
    assert.equal((await save(db, id, version, { ...first, first_sentence: "Replacement" })).rows[0].id, first.id);
    assert.equal((await current()).version, latestVersion);
    await close(db, await current());
    assert.equal((await save(db, id, version, first)).rows[0].id, first.id);
    assert.equal(await wordCount(), 1);
    assert.equal((await db.query("select first_sentence from words")).rows[0].first_sentence, first.first_sentence);
  });
  await t.test("direct inserts obey selected count, reductions cannot invalidate saved words, plan stays two", async () => {
    await db.query("update study_sessions set chosen_words = 3 where id = $1", [id]);
    await insertWord(db, id, word("one")); await insertWord(db, id, word("two"));
    await assert.rejects(db.query("update study_sessions set chosen_words = 1 where id = $1", [id]), limitError);
    await db.query("update study_sessions set chosen_words = 2 where id = $1", [id]);
    await assert.rejects(insertWord(db, id, word("three")), limitError);
    await assert.rejects(db.query("update study_sessions set planned_words = 3 where id = $1", [id]), e => e.code === "23514");
    assert.equal((await current()).planned_words, 2);
    assert.equal((await current()).chosen_words, 2);
    await assert.rejects(db.query("update study_sessions set chosen_words = 4 where id = $1", [id]), e => e.code === "23514");
  });
  await t.test("a multi-row direct insert cannot overfill the session; the whole statement rolls back", async () => {
    await assert.rejects(db.query(`insert into words(id, session_id, target, learn_date, meaning, part_of_speech, source_example, source_url, first_sentence)
      select gen_random_uuid(), $1::uuid, 'batch-' || n, '2026-11-15'::date, 'meaning', 'noun', 'example', 'https://example.com', 'My original.' from generate_series(1,3) n`, [id]), limitError);
    assert.equal(await wordCount(), 0);
    assert.equal((await current()).version, 0);
  });
  await t.test("invalid intervals atomically roll back save/close, including trigger version updates", async () => {
    const draft = word();
    await db.query("update study_sessions set draft = $1::jsonb where id = $2", [JSON.stringify(draft), id]);
    const original = await current();
    await assert.rejects(save(db, id, original.version, draft, [{ start: 5, end: 2 }]), e => e.code === "23514");
    await assert.rejects(close(db, original, draft, [{ start: 5, end: 2 }]), e => e.code === "23514");
    assert.deepEqual((await current()).draft, draft);
    assert.equal((await current()).version, original.version);
    assert.equal((await current()).status, "draft");
    assert.equal(await wordCount(), 0);
  });
  await t.test("stale versions, normalized duplicates and weekend exceptions remain enforced", async () => {
    await save(db, id, 0, word());
    const version = (await current()).version;
    await assert.rejects(save(db, id, 0, word("approach")), e => e.code === "40001");
    await assert.rejects(save(db, id, version, word(" ANALYSIS ")), e => e.code === "23505");
    await assert.rejects(save(db, id, version, { ...word("approach"), learn_date: "2026-11-14" }), e => e.code === "42501");
    assert.equal((await current()).version, version);
    await close(db, await current());
    const reviewId = (await db.query("select start_study_session('2026-11-14', false) as id")).rows[0].id;
    await assert.rejects(insertWord(db, reviewId), e => e.code === "42501");
  });
  await t.test("original sentences remain immutable, and authorized clients cannot move/delete words", async () => {
    const original = word(); await save(db, id, 0, original);
    await assert.rejects(db.query("update words set first_sentence = 'changed' where id = $1", [original.id]), e => e.code === "42501");
    await assert.rejects(db.query("update words set session_id = gen_random_uuid() where id = $1", [original.id]), e => e.code === "42501");
    await assert.rejects(db.query("delete from words where id = $1", [original.id]), e => e.code === "42501");
    await db.exec("reset role");
    await assert.rejects(db.query("update words set first_sentence = 'changed' where id = $1", [original.id]), /immutable/);
  });
  await t.test("another account cannot read, alter, close, or write into the learner's active/history sessions", async () => {
    await save(db, id, 0, word());
    const original = await current(); await close(db, original);
    const activeId = await start(db);
    await identity(db, learnerB);
    assert.deepEqual((await db.query("select * from words")).rows, []);
    assert.deepEqual((await db.query("select * from study_sessions")).rows, []);
    assert.equal((await db.query("update study_sessions set chosen_words = 3 where id = $1 returning id", [activeId])).rows.length, 0);
    await assert.rejects(close(db, original), e => e.code === "42501");
    await assert.rejects(insertWord(db, activeId), e => e.code === "42501");
    await assert.rejects(db.query("insert into study_sessions(user_id, local_date, session_type) values ($1, '2026-11-15', 'learning')", [learnerA]), e => e.code === "42501");
    const otherId = await start(db);
    assert.notEqual(otherId, activeId);
    assert.equal((await db.query("select count(*)::int as n from study_sessions")).rows[0].n, 1);
  });
  await t.test("anonymous callers cannot access tables or lifecycle/save RPCs", async () => {
    const original = await current();
    await identity(db, "", "anon");
    await assert.rejects(db.query("select * from words"), e => e.code === "42501");
    await assert.rejects(db.query("select * from study_sessions"), e => e.code === "42501");
    await assert.rejects(start(db), e => e.code === "42501");
    await assert.rejects(close(db, original), e => e.code === "42501");
    await assert.rejects(save(db, id, 0, word()), e => e.code === "42501");
  });
});
