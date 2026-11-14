import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { identitySchema, identity, learnerA, learnerB, migrationSql, word, session, close, save, intervals } from "./helpers/database.mjs";
import { reviewCards } from "../src/lib/reviews.ts";

export async function record(db, sid, wid, due, recall = "remembered", sentence = null, id = randomUUID(), version) {
  return (await db.query("select record_review($1,$2,$3,$4,$5,$6,$7,'UTC',$8::jsonb) id", [id,sid,version ?? (await session(db,sid)).version,wid,due,recall,sentence,JSON.stringify(intervals)])).rows[0].id;
}
export async function feedback(db, sid, aid, sentence = null, acknowledge = true) {
  if (acknowledge) await db.query("select reveal_review_answer($1)",[aid]);
  return db.query("select finish_review_feedback($1,$2,$3,$4,$5,'UTC')", [aid,sid,(await session(db,sid)).version,sentence,acknowledge]);
}
export async function practice(db, mode = "MVD", timezone = "UTC") {
  return (await db.query("select start_practice_session($1,$2,false) id", [mode,timezone])).rows[0].id;
}
export async function complete(db, sid) {
  return db.query("select complete_practice_session($1,$2,$3::jsonb)", [sid,(await session(db,sid)).version,JSON.stringify(intervals)]);
}
async function seed(db, days = 7, count = 1) {
  const date = (await db.query("select ((statement_timestamp() at time zone 'UTC')::date-$1::integer)::text d", [days])).rows[0].d;
  const sid = (await db.query("select start_study_session($1,true) id", [date])).rows[0].id;
  await db.query("update study_sessions set chosen_words=3 where id=$1",[sid]);
  const words = [];
  for (let i=0;i<count;i++) {
    const w = { ...word(i === 0 ? "analysis" : `word-${i}`), learn_date: date };
    await save(db,sid,(await session(db,sid)).version,w); words.push(w);
  }
  await close(db,await session(db,sid));
  return words;
}

test("migration backfills pre-existing Slice 01 words without rewriting evidence", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(identitySchema);
  await db.exec(await readFile(new URL("../supabase/migrations/20261114000100_vertical_slice_01.sql", import.meta.url),"utf8"));
  await db.query("insert into auth.users values ($1),($2)",[learnerA,learnerB]);
  await identity(db,learnerA); const a = (await seed(db,0))[0];
  await identity(db,learnerB); const b = (await seed(db,0))[0];
  await db.exec("reset role");
  const before = (await db.query("select * from words order by user_id")).rows;
  await db.exec(await readFile(new URL("../supabase/migrations/20261114000200_vertical_slice_02.sql",import.meta.url),"utf8"));
  assert.deepEqual((await db.query("select * from words order by user_id")).rows,before);
  assert.equal((await db.query("select count(*)::int n from review_obligations")).rows[0].n,10);
  await identity(db,learnerA);
  await db.query("select backfill_review_obligations()"); await db.query("select backfill_review_obligations()");
  const rows=(await db.query("select word_id,checkpoint,(due_date-(select learn_date from words where id=word_id)) delta from review_obligations order by checkpoint")).rows;
  assert.deepEqual(rows.map(r=>r.checkpoint),[1,3,7,14,30]); assert.deepEqual(rows.map(r=>r.delta),[1,3,7,14,30]);
  assert.ok(rows.every(r=>r.word_id===a.id && r.word_id!==b.id));
});

test("review evidence, MVD qualification and account boundaries", async t => {
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(identitySchema); await db.exec(await migrationSql());
  t.beforeEach(async()=> {
    await db.exec("reset role; truncate auth.users cascade");
    await db.query("insert into auth.users values ($1),($2)",[learnerA,learnerB]);
    await identity(db,learnerA);
  });
  const today=()=>db.query("select learner_today('UTC')::text d").then(r=>r.rows[0].d);
  const pending=()=>db.query("select *,due_date::text due_date from review_schedule where due_date<=learner_today('UTC') and not completed order by review_schedule.due_date").then(r=>r.rows);
  const qualifies=sid=>db.query("select session_has_completion_evidence($1) q",[sid]).then(r=>r.rows[0].q);

  await t.test("multi-word reviews stay due and cannot finish with only one acknowledged answer",async()=> {
    const words=await seed(db,1,3); const sid=await practice(db,'review');
    const due=await today(); const ids=[];
    for (const w of words) ids.push(await record(db,sid,w.id,due));
    const originals=(await db.query("select * from review_attempts order by id")).rows;
    await feedback(db,sid,ids[0]);
    await assert.rejects(complete(db,sid),e=>e.code==='23514');
    assert.equal((await pending()).length,2);
    assert.equal((await db.query("select count(*)::int n from review_schedule where kind='milestone' and completed")).rows[0].n,1);
    const incomplete=(await pending());
    assert.ok(incomplete.every(r=>!r.milestone_metric_eligible && r.completed_at===null && r.completed_date===null));
    assert.equal(await qualifies(sid),false);
    await db.query("select reveal_review_answer($1)",[ids[1]]);
    assert.equal((await pending()).length,2); // Revealing alone is not checking/correcting.
    await feedback(db,sid,ids[1]);
    assert.equal(await qualifies(sid),false);
    await feedback(db,sid,ids[2]);
    assert.equal((await pending()).length,0);
    assert.equal((await db.query("select count(*)::int n from review_schedule where milestone_metric_eligible")).rows[0].n,3);
    assert.equal(await qualifies(sid),true); await complete(db,sid);
    assert.deepEqual((await db.query("select * from review_attempts order by id")).rows,originals);
  });

  await t.test("review-only sessions cannot leave extra-practice answers unchecked",async()=> {
    const [a,b]=await seed(db,0,2); const sid=await practice(db,'review');
    const first=await record(db,sid,a.id,null); const second=await record(db,sid,b.id,null);
    await feedback(db,sid,first);
    assert.equal(await qualifies(sid),false);
    await assert.rejects(complete(db,sid),e=>e.code==='23514');
    await feedback(db,sid,second); await complete(db,sid);
  });

  await t.test("every saved word gets five immutable milestones; missing is not Forgot",async()=> {
    const [w]=await seed(db,7);
    assert.equal((await db.query("select * from review_obligations where word_id=$1",[w.id])).rows.length,5);
    const due=await pending(); assert.equal(due.length,3);
    assert.ok(due.every(r=>r.recall===null && r.actual_date===null && !r.completed));
    assert.equal(due[0].due_date<await today(),true);
    await assert.rejects(db.query("update review_obligations set due_date=due_date+1"),e=>e.code==='42501');
  });
  await t.test("Forgot is first-only, late is factual, remedial is actual-next-day and idempotent",async()=> {
    const [w]=await seed(db,7); const sid=await practice(db,"review"); const due=(await pending())[0].due_date;
    const id=randomUUID(); const v=(await session(db,sid)).version;
    const aid=await record(db,sid,w.id,due,"forgot",null,id,v);
    assert.equal(await record(db,sid,w.id,due,"remembered",null,id,v),aid);
    const a=(await db.query("select *,actual_date::text actual_date from review_attempts")).rows[0];
    assert.equal(a.recall,"forgot"); assert.equal(a.was_late,true); assert.equal(a.actual_date,await today());
    const remedial=(await db.query("select *,due_date-learner_today('UTC') delta from review_obligations where kind='remedial'")).rows;
    assert.equal(remedial.length,1); assert.equal(remedial[0].delta,1);
    assert.equal((await db.query("select * from review_obligations where kind='milestone'")).rows.length,5);
    await assert.rejects(db.query("delete from review_attempts"),e=>e.code==='42501');
    await db.exec("reset role");
    await assert.rejects(db.query("update review_attempts set recall='remembered'"),e=>e.code==='23514');
  });
  await t.test("Day +7 partial recall stays due and immutable production remains ungraded",async()=> {
    const [w]=await seed(db,7); const sid=await practice(db); const due=await today();
    const aid=await record(db,sid,w.id,due,"remembered");
    assert.ok((await pending()).some(r=>r.checkpoint===7));
    await assert.rejects(feedback(db,sid,aid),e=>e.code==='23514');
    const sentence="  My new analysis has a different context.\n  ";
    await feedback(db,sid,aid,sentence,false);
    await feedback(db,sid,aid,"Replacement",false);
    const p=(await db.query("select * from review_productions")).rows[0];
    assert.equal(p.first_sentence,sentence); assert.equal(p.evaluation_state,'pending_evaluation'); assert.equal(p.score,undefined);
    assert.equal((await pending()).some(r=>r.checkpoint===7),true);
    assert.equal(await qualifies(sid),false); // Revealing/correcting remains outstanding.
    await db.query("select reveal_review_answer($1)",[aid]);
    assert.equal((await pending()).some(r=>r.checkpoint===7),true);
    await feedback(db,sid,aid); assert.equal(await qualifies(sid),true);
    assert.equal((await pending()).some(r=>r.checkpoint===7),false);
  });
  await t.test("partial Day +7 can resume after an incomplete session is closed",async()=> {
    const [w]=await seed(db,7); const first=await practice(db,"review");
    const aid=await record(db,first,w.id,await today());
    await close(db,await session(db,first));
    const second=await practice(db); await feedback(db,second,aid,"An independent sentence.",false); await feedback(db,second,aid);
    assert.equal(await qualifies(second),true);
    assert.equal((await session(db,first)).status,'closed_incomplete');
  });
  await t.test("coinciding remedial and milestone share one result with distinct obligations",async()=> {
    const [w]=await seed(db,3); const sid=await practice(db,"review"); const due=await today();
    // Historical collision fixture, bypassing no application permissions.
    await db.exec("reset role");
    await db.query("insert into review_obligations(user_id,word_id,kind,due_date) values($1,$2,'remedial',$3)",[learnerA,w.id,due]);
    await identity(db,learnerA);
    const aid=await record(db,sid,w.id,due);
    assert.equal((await pending()).filter(r=>r.attempt_id===aid).length,2);
    await db.query("select reveal_review_answer($1)",[aid]);
    assert.equal((await pending()).filter(r=>r.attempt_id===aid).length,2);
    await feedback(db,sid,aid);
    const rows=(await db.query("select * from review_schedule where word_id=$1 and due_date=$2",[w.id,due])).rows;
    assert.equal(rows.length,2); assert.ok(rows.every(r=>r.completed && r.attempt_id===aid));
    assert.deepEqual(rows.map(r=>r.kind).sort(),['milestone','remedial']);
    assert.equal(rows.filter(r=>r.milestone_metric_eligible).length,1);
  });

  await t.test("MVD due targets require every started answer check but may leave unattempted obligations due",async()=> {
    await seed(db,1,3); const sid=await practice(db); const s=await session(db,sid);
    const ids=[];
    for(const wid of s.mvd_targets) ids.push(await record(db,sid,wid,await today(),'forgot'));
    await feedback(db,sid,ids[0]);
    assert.equal(await qualifies(sid),false); await assert.rejects(complete(db,sid),e=>e.code==='23514');
    await feedback(db,sid,ids[1]);
    assert.equal(await qualifies(sid),true);
    assert.equal((await pending()).length,1);
    assert.equal((await db.query("select count(*)::int n from review_obligations where kind='remedial'")).rows[0].n,2);
    await complete(db,sid);
  });

  await t.test("MVD extra targets cannot qualify from partially acknowledged multi-word practice",async()=> {
    const words=await seed(db,0,3); const sid=await practice(db); const ids=[];
    for(const w of words) ids.push(await record(db,sid,w.id,null));
    await feedback(db,sid,ids[0]); await feedback(db,sid,ids[1]);
    // Two checked words meet the target, but the third started attempt is unfinished.
    assert.equal(await qualifies(sid),false); await assert.rejects(complete(db,sid),e=>e.code==='23514');
    await feedback(db,sid,ids[2]); await complete(db,sid);
  });

  await t.test("unacknowledged recalls from closed drafts stay recoverable without a new first result",async()=> {
    const [w]=await seed(db,1); const first=await practice(db,'review');
    const aid=await record(db,first,w.id,await today());
    const original=(await db.query("select * from review_attempts where id=$1",[aid])).rows[0];
    await close(db,await session(db,first));
    assert.equal((await pending())[0].attempt_id,aid);
    const second=await practice(db,'review');
    await feedback(db,second,aid); await complete(db,second);
    assert.equal((await pending()).length,0);
    assert.deepEqual((await db.query("select * from review_attempts where id=$1",[aid])).rows[0],original);
  });

  await t.test("completion timing stays separate from immutable first-recall timing for future metrics",async()=> {
    const [w]=await seed(db,1); const sid=await practice(db,'review'); const due=await today();
    const aid=await record(db,sid,w.id,due); await db.query("select reveal_review_answer($1)",[aid]);
    const original=(await db.query("select * from review_attempts where id=$1",[aid])).rows[0];
    // Historical fixture representing acknowledgment on the next local date.
    await db.exec("reset role");
    await db.query("insert into review_feedback(attempt_id,user_id,session_id,actual_date,acknowledged_at) values($1,$2,$3,$4::date+1,clock_timestamp()+interval '1 day')",[aid,learnerA,sid,due]);
    await identity(db,learnerA);
    const r=(await db.query("select *,completed_date-due_date delta from review_schedule where attempt_id=$1",[aid])).rows[0];
    assert.equal(r.completed,true); assert.equal(r.milestone_metric_eligible,true);
    assert.equal(r.was_late,false); assert.equal(r.completion_was_late,true); assert.equal(r.delta,1);
    assert.deepEqual((await db.query("select * from review_attempts where id=$1",[aid])).rows[0],original);
  });
  await t.test("MVD due path needs two distinct words, not two cards of one word",async()=> {
    const [a,b]=await seed(db,7,3); const sid=await practice(db);
    const s=await session(db,sid); assert.equal(s.mvd_path,'due'); assert.equal(s.mvd_targets.length,2);
    const cards=await pending();
    const targets=s.mvd_targets; const first=cards.find(r=>r.word_id===targets[0]);
    const secondSame=cards.find(r=>r.word_id===targets[0] && r.due_date!==first.due_date);
    for(const r of [first,secondSame]) { const aid=await record(db,sid,r.word_id,r.due_date,'remembered',r.checkpoint===7?'A new sentence.':null); await feedback(db,sid,aid); }
    assert.equal(await qualifies(sid),false); await assert.rejects(complete(db,sid),e=>e.code==='23514');
    const other=cards.find(r=>r.word_id===targets[1]); const aid=await record(db,sid,other.word_id,other.due_date,'remembered',other.checkpoint===7?'Another new sentence.':null); await feedback(db,sid,aid);
    await complete(db,sid); assert.equal((await session(db,sid)).status,'completed'); assert.ok((await pending()).length>0);
    assert.ok(a.id!==b.id);
  });
  await t.test("MVD with one distinct due word needs only that word and feedback",async()=> {
    const [w]=await seed(db,1); const sid=await practice(db);
    assert.equal((await session(db,sid)).mvd_targets.length,1);
    const aid=await record(db,sid,w.id,await today()); assert.equal(await qualifies(sid),false);
    await feedback(db,sid,aid); await complete(db,sid);
    assert.equal((await session(db,sid)).planned_words,2);
  });
  await t.test("MVD extra path: one recall alone fails; independent sentence or second word qualifies",async()=> {
    const [w]=await seed(db,0); const sid=await practice(db);
    assert.equal((await session(db,sid)).mvd_path,'extra');
    const aid=await record(db,sid,w.id,null);
    assert.equal(await qualifies(sid),false);
    await feedback(db,sid,aid,"A new short sentence.",false);
    await feedback(db,sid,aid);
    assert.equal(await qualifies(sid),true); await complete(db,sid);
    assert.equal((await db.query("select count(*)::int n from review_schedule where completed")).rows[0].n,0);
  });
  await t.test("MVD extra path: two recalls of the same word fail, two distinct words qualify",async()=> {
    const [a,b]=await seed(db,0,2); const sid=await practice(db);
    for(let i=0;i<2;i++) { const aid=await record(db,sid,a.id,null); await feedback(db,sid,aid); }
    assert.equal(await qualifies(sid),false);
    const aid=await record(db,sid,b.id,null); await feedback(db,sid,aid); assert.equal(await qualifies(sid),true);
  });
  await t.test("first-day MVD only completes with genuine one-word learning, including weekends",async()=> {
    const sid=await practice(db); const s=await session(db,sid);
    assert.equal(s.mvd_path,'learn'); assert.equal(await qualifies(sid),false);
    await assert.rejects(complete(db,sid),e=>e.code==='23514');
    const w={...word(),learn_date:await today()}; await save(db,sid,s.version,w);
    await assert.rejects(save(db,sid,(await session(db,sid)).version,{...word('second'),learn_date:await today()}),e=>e.code==='23514');
    await complete(db,sid); assert.equal((await session(db,sid)).status,'completed');
    assert.equal((await db.query("select count(*)::int n from review_obligations")).rows[0].n,5);
    assert.equal((await db.query("select first_sentence from words")).rows[0].first_sentence,w.first_sentence);
  });
  await t.test("empty sessions and full learning sessions cannot claim completion; review-only can",async()=> {
    const [w]=await seed(db,1); const sid=await practice(db,"review");
    await assert.rejects(complete(db,sid),e=>e.code==='23514');
    const aid=await record(db,sid,w.id,await today()); await feedback(db,sid,aid); await complete(db,sid);
    const learn=(await db.query("select start_study_session(learner_today('UTC'),true) id")).rows[0].id;
    await save(db,learn,(await session(db,learn)).version,{...word('new'),learn_date:await today()});
    await assert.rejects(complete(db,learn),e=>e.code==='23514');
  });
  await t.test("review-first learning gate rejects bypasses without losing a draft or word",async()=> {
    await seed(db,1); const sid=(await db.query("select start_study_session(learner_today('UTC'),true) id")).rows[0].id;
    const before=await session(db,sid);
    await assert.rejects(save(db,sid,before.version,{...word('new'),learn_date:await today()}),e=>e.code==='23514');
    assert.deepEqual(await session(db,sid),before);
  });
  await t.test("cross-account and anonymous access, direct evidence writes and stale versions are blocked",async()=> {
    const [w]=await seed(db,1); const sid=await practice(db); const before=await session(db,sid);
    const aid=await record(db,sid,w.id,await today());
    await assert.rejects(record(db,sid,w.id,null,'remembered',null,randomUUID(),before.version),e=>e.code==='40001');
    await assert.rejects(db.query("update study_sessions set mvd_targets='{}' where id=$1",[sid]),e=>e.code==='23514');
    await feedback(db,sid,aid);
    assert.equal((await db.query("select review_attempt_is_complete($1) complete",[aid])).rows[0].complete,true);
    await identity(db,learnerB);
    assert.equal((await db.query("select review_attempt_is_complete($1) complete",[aid])).rows[0].complete,false);
    for(const table of ['review_obligations','review_attempts','review_productions','review_feedback','review_schedule']) assert.equal((await db.query(`select * from ${table}`)).rows.length,0);
    await assert.rejects(record(db,sid,w.id,await today(),'remembered',null,randomUUID(),0),e=>e.code==='42501');
    await assert.rejects(db.query("select finish_review_feedback($1,$2,0,null,true,'UTC')",[aid,sid]),e=>e.code==='42501');
    await identity(db,'','anon');
    await assert.rejects(practice(db),e=>e.code==='42501');
    await assert.rejects(db.query("select * from review_schedule"),e=>e.code==='42501');
    await assert.rejects(db.query("select backfill_review_obligations()"),e=>e.code==='42501');
    await assert.rejects(db.query("select review_attempt_is_complete($1)",[aid]),e=>e.code==='42501');
  });
  await t.test("IANA timezone validation and date arithmetic span UTC offsets without changing weekdays",async()=> {
    for(const tz of ['Africa/Cairo','America/Los_Angeles','Pacific/Kiritimati']) {
      const date=(await db.query("select learner_today($1)::text d",[tz])).rows[0].d;
      const expected=(await db.query("select (statement_timestamp() at time zone $1)::date::text d",[tz])).rows[0].d;
      assert.equal(date,expected);
    }
    await assert.rejects(practice(db,'MVD','Not/A_Timezone'),e=>e.code==='23514');
  });
  await t.test("answers require stored first attempts; production cannot be added after reveal",async()=> {
    const [w]=await seed(db,0); const sid=await practice(db);
    await assert.rejects(db.query("select reveal_review_answer($1)",[randomUUID()]),e=>e.code==='42501');
    const aid=await record(db,sid,w.id,null);
    await assert.rejects(db.query("select finish_review_feedback($1,$2,$3,null,true,'UTC')",[aid,sid,(await session(db,sid)).version]),e=>e.code==='23514');
    await db.query("select reveal_review_answer($1)",[aid]);
    await assert.rejects(feedback(db,sid,aid,"A sentence after seeing the answer.",false),e=>e.code==='23514');
    await feedback(db,sid,aid); assert.equal(await qualifies(sid),false);
  });
  await t.test("administrative removal of a disposable learner cascades all dependent evidence",async()=> {
    const [w]=await seed(db,7); const sid=await practice(db);
    const aid=await record(db,sid,w.id,await today(),'forgot','A new independent sentence.');
    await feedback(db,sid,aid); await complete(db,sid);
    await db.exec("reset role"); await db.query("delete from auth.users where id=$1",[learnerA]);
    for(const table of ['words','study_sessions','review_obligations','review_attempts','review_productions','review_feedback','review_reveals']) assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
  });
});

test("review queue orders overdue first and combines only the same word/date",()=> {
  const rows=[{id:'1',word_id:'a',due_date:'2026-11-15',kind:'milestone',checkpoint:3},{id:'2',word_id:'a',due_date:'2026-11-15',kind:'remedial'},{id:'3',word_id:'a',due_date:'2026-11-13',kind:'milestone',checkpoint:1}];
  const cards=reviewCards(rows); assert.equal(cards.length,2); assert.equal(cards[0].due_date,'2026-11-13'); assert.equal(cards[1].obligations.length,2);
});

