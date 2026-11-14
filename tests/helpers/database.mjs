import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const learnerA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const learnerB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const intervals = [{ start: 1000, end: 3000 }, { start: 10000, end: 11000 }];
export const identitySchema = `
  create role anon;
  create role authenticated;
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;
export async function migrationSql() {
  return readFile(new URL("../../supabase/migrations/20261114000100_vertical_slice_01.sql", import.meta.url), "utf8");
}
export function word(target = "analysis") {
  return { id: randomUUID(), target, learn_date: "2026-11-15", meaning: "a detailed examination", part_of_speech: "noun", source_example: "Example from the source.", source_url: "https://ieltstutors.org/academic-word-list/", context: "", word_family: "", synonym: "", first_sentence: "  My analysis have mistakes.\n  " };
}
export async function identity(db, user, role = "authenticated") {
  if (!["authenticated", "anon"].includes(role)) throw new Error("Unexpected test role");
  await db.query("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  await db.query(`set role ${role}`);
}
export async function start(db) {
  return (await db.query("select public.start_study_session('2026-11-15', false) as id")).rows[0].id;
}
export async function session(db, id) {
  return (await db.query("select * from public.study_sessions where id = $1", [id])).rows[0];
}
export function save(db, id, version, data, timing = intervals) {
  return db.query("select public.save_session_word($1, $2, $3::jsonb, $4::jsonb) as id", [id, version, JSON.stringify(data), JSON.stringify(timing)]);
}
export function close(db, s, draft = s.draft, timing = s.intervals) {
  return db.query("select public.close_study_session($1, $2, $3::jsonb, $4::jsonb, $5, $6) as id", [s.id, s.version, JSON.stringify(draft), JSON.stringify(timing), s.chosen_words, s.exceptional_learning]);
}
export function insertWord(db, sessionId, data = word()) {
  return db.query(`insert into public.words(id, session_id, target, learn_date, meaning, part_of_speech, source_example, source_url, first_sentence)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`, [data.id, sessionId, data.target, data.learn_date, data.meaning, data.part_of_speech, data.source_example, data.source_url, data.first_sentence]);
}
