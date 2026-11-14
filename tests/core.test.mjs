import test from "node:test";
import assert from "node:assert/strict";
import { activeMilliseconds, formatTime, heartbeat, validIntervals } from "../src/lib/stopwatch.ts";
import { validateWord, validDate, isReviewDay, localDate } from "../src/lib/model.ts";
import { loadWords } from "../src/lib/data.ts";
import { createClient } from "@supabase/supabase-js";

const word = {
  id: "00000000-0000-4000-8000-000000000001", target: "analysis", learn_date: "2026-11-15",
  meaning: "a detailed examination", part_of_speech: "noun", source_example: "A source example.",
  source_url: "https://ieltstutors.org/academic-word-list/", context: "", word_family: "", synonym: "",
  first_sentence: "  My analysis have mistakes.\nI keep my first try.  ",
};
test("word validation preserves original learner evidence exactly and strips extra properties", () => {
  const validated = validateWord({ ...word, user_id: "untrusted", initial_score: 2 });
  assert.equal(validated.first_sentence, word.first_sentence);
  assert.equal(validated.user_id, undefined);
  assert.equal(validated.initial_score, undefined);
});
test("word validation rejects empty evidence, missing meaning, invalid dates, unsafe URLs and oversize input", () => {
  for (const patch of [{ first_sentence: " " }, { meaning: "" }, { learn_date: "2026-02-30" }, { source_url: "javascript:alert(1)" }, { target: "x".repeat(101) }, { part_of_speech: "invented" }]) assert.throws(() => validateWord({ ...word, ...patch }));
  assert.equal(validDate("2026-99-99"), false);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2028-02-29"), true);
});
test("calendar uses the learner's local date and Friday/Saturday are review-only", () => {
  assert.equal(localDate(new Date(2026, 10, 15, 0, 1)), "2026-11-15");
  assert.equal(isReviewDay("2026-11-13"), true);
  assert.equal(isReviewDay("2026-11-14"), true);
  assert.equal(isReviewDay("2026-11-15"), false);
});
test("weekday rules cover the full week without depending on the server timezone", () => {
  for (let offset = 0; offset < 7; offset++) {
    assert.equal(isReviewDay(`2026-11-${15 + offset}`), offset >= 5);
  }
});
test("local calendar dates honor the configured timezone at learning/review boundaries", () => {
  const instant = new Date("2026-11-12T22:00:00Z");
  assert.equal(localDate(instant, "Africa/Cairo"), "2026-11-13");
  assert.equal(isReviewDay(localDate(instant, "Africa/Cairo")), true);
  assert.equal(localDate(instant, "America/Los_Angeles"), "2026-11-12");
  assert.equal(isReviewDay(localDate(instant, "America/Los_Angeles")), false);
  assert.equal(isReviewDay(localDate(new Date("2026-11-14T21:59:59Z"), "Africa/Cairo")), true);
  assert.equal(isReviewDay(localDate(new Date("2026-11-14T22:00:00Z"), "Africa/Cairo")), false);
});
test("timezone conversion respects seasonal offsets and dates on either side of UTC", () => {
  assert.equal(localDate(new Date("2026-06-04T21:00:00Z"), "Africa/Cairo"), "2026-06-05");
  assert.equal(localDate(new Date("2026-11-14T23:30:00Z"), "Pacific/Kiritimati"), "2026-11-15");
  assert.equal(localDate(new Date("2026-11-15T00:30:00Z"), "America/Los_Angeles"), "2026-11-14");
});
test("stopwatch counts active intervals while excluding gaps between pause and resume", () => {
  const intervals = [{ start: 1000, end: 4000 }, { start: 60000, end: 62000 }];
  assert.equal(activeMilliseconds(intervals), 5000);
  assert.equal(formatTime(activeMilliseconds(intervals)), "00:00:05");
  assert.equal(formatTime(3661000), "01:01:01");
});
test("heartbeats discard suspended/offline/reload gaps without mutating persisted intervals", () => {
  const intervals = [{ start: 1000, end: 2000 }];
  assert.equal(activeMilliseconds(heartbeat(intervals, 1000).intervals), 2000);
  const recovered = JSON.parse(JSON.stringify(intervals));
  assert.equal(activeMilliseconds(recovered), 1000);
  for (const gap of [60000, 86400000, -1, NaN]) {
    const result = heartbeat(recovered, gap);
    assert.equal(result.running, false);
    assert.deepEqual(result.intervals, intervals);
  }
  assert.deepEqual(intervals, [{ start: 1000, end: 2000 }]);
});
test("interval validation rejects overlapping, reversed and non-finite intervals", () => {
  assert.equal(validIntervals([]), true);
  assert.equal(validIntervals([{ start: 1000, end: 2000 }, { start: 3000, end: 4000 }]), true);
  for (const invalid of [null, {}, [{ start: 2, end: 1 }], [{ start: 1, end: Infinity }], [{ start: -1, end: 2 }], [{ start: 1, end: 5 }, { start: 4, end: 6 }]]) assert.equal(validIntervals(invalid), false);
});
test("My Words loads via Supabase with explicit account scope and chronological ordering", async () => {
  let requested;
  const client = createClient("https://example.supabase.co", "public-test-placeholder", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async url => {
      requested = new URL(url);
      return new Response(JSON.stringify([word]), { headers: { "Content-Type": "application/json" } });
    } },
  });
  const result = await loadWords(client, "learner-a");
  assert.equal(requested.searchParams.get("user_id"), "eq.learner-a");
  assert.equal(requested.searchParams.get("order"), "learn_date.desc,created_at.desc");
  assert.equal(result[0].first_sentence, word.first_sentence);
});
test("failed reads surface an error instead of a misleading empty word collection", async () => {
  const client = createClient("https://example.supabase.co", "public-test-placeholder", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async () => new Response(JSON.stringify({ message: "Unavailable" }), { status: 403, headers: { "Content-Type": "application/json" } }) },
  });
  await assert.rejects(loadWords(client, "learner-a"), /could not be loaded/);
});
