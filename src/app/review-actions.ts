"use server";

import { revalidatePath } from "next/cache";
import { requireLearner } from "@/lib/supabase/server";
import { isUuid, validDate } from "@/lib/model";
import type { Session } from "@/lib/model";
import { validIntervals } from "@/lib/stopwatch";
import { reviewCards, type ReviewAttempt, type ReviewItem, type ReviewState } from "@/lib/reviews";

export async function reviewState(timezone: string, sessionId?: string): Promise<ReviewState> {
  const { supabase, user } = await requireLearner();
  const { data: today, error: dateError } = await supabase.rpc("learner_today", { p_timezone: timezone });
  if (dateError) throw new Error("Could not determine your local review date.");
  const [queue, words, attempts, qualified] = await Promise.all([
    supabase.from("review_schedule").select("id,word_id,kind,checkpoint,due_date,target,part_of_speech,attempt_id,completed").eq("user_id", user.id).lte("due_date", today).eq("completed", false).order("due_date"),
    supabase.from("words").select("id,target,part_of_speech").eq("user_id", user.id).order("learn_date"),
    sessionId ? supabase.from("review_attempts").select("*,review_productions(first_sentence,evaluation_state),review_feedback(actual_date)").eq("user_id", user.id).eq("session_id", sessionId).order("attempted_at") : Promise.resolve({ data: [], error: null }),
    sessionId ? supabase.rpc("session_has_completion_evidence", { p_id: sessionId }) : Promise.resolve({ data: false, error: null }),
  ]);
  if (queue.error || words.error || attempts.error || qualified.error) throw new Error("Could not load reviews. Check the connection and Slice 02 migration.");
  const pendingIds = [...new Set((queue.data as ReviewItem[]).map(r => r.attempt_id).filter(Boolean))];
  const pending = pendingIds.length ? await supabase.from("review_attempts").select("*,review_productions(first_sentence,evaluation_state),review_feedback(actual_date)").eq("user_id", user.id).in("id", pendingIds) : { data: [], error: null };
  if (pending.error) throw new Error("Could not load partial reviews.");
  const all = new Map<string, ReviewAttempt>();
  for (const a of [...(attempts.data ?? []), ...(pending.data ?? [])] as ReviewAttempt[]) {
    all.set(a.id, { ...a,
      review_productions: Array.isArray(a.review_productions) ? a.review_productions : a.review_productions ? [a.review_productions] : [],
      review_feedback: Array.isArray(a.review_feedback) ? a.review_feedback : a.review_feedback ? [a.review_feedback] : [],
    });
  }
  return { today, queue: reviewCards(queue.data as ReviewItem[]), oldWords: words.data!, attempts: [...all.values()], qualified: Boolean(qualified.data) };
}

export async function submitReview(input: { id: string; sessionId: string; version: number; wordId: string; due: string | null; recall: string; sentence: string; timezone: string; intervals: unknown }) {
  const { supabase } = await requireLearner();
  if (![input.id, input.sessionId, input.wordId].every(isUuid) || !Number.isInteger(input.version) || !["remembered", "forgot"].includes(input.recall) || (input.due !== null && !validDate(input.due)) || typeof input.sentence !== "string" || input.sentence.length > 5000 || !validIntervals(input.intervals)) return { error: "Check your review. Your draft is kept." };
  const { data, error } = await supabase.rpc("record_review", { p_id: input.id, p_session_id: input.sessionId, p_version: input.version, p_word_id: input.wordId, p_scheduled_date: input.due, p_recall: input.recall, p_sentence: input.sentence.trim() ? input.sentence : null, p_timezone: input.timezone, p_intervals: input.intervals });
  if (error) return { error: error.code === "40001" ? "This draft changed elsewhere. Reload before continuing; your local copy is kept." : "Could not save this first attempt. Check your connection and active session, then retry." };
  return { id: data as string };
}

export async function revealReview(id: string) {
  const { supabase } = await requireLearner();
  if (!isUuid(id)) return { error: "Invalid review." };
  const { data, error } = await supabase.rpc("reveal_review_answer", { p_attempt_id: id });
  return error ? { error: "Save your first recall and independent Day +7 sentence before revealing feedback. Check your connection if already saved." } : { answer: data as { target: string; meaning: string; source_example: string } };
}

export async function finishReview(id: string, sessionId: string, version: number, sentence: string, acknowledge: boolean, timezone: string) {
  const { supabase } = await requireLearner();
  if (!isUuid(id) || !isUuid(sessionId) || !Number.isInteger(version) || typeof sentence !== "string" || sentence.length > 5000 || typeof acknowledge !== "boolean") return { error: "Check your independent sentence." };
  const { error } = await supabase.rpc("finish_review_feedback", { p_attempt_id: id, p_session_id: sessionId, p_version: version, p_sentence: sentence.trim() ? sentence : null, p_acknowledge: acknowledge, p_timezone: timezone });
  return error ? { error: "Could not save review feedback. Keep your draft and retry." } : { saved: true };
}

export async function refreshPracticeSession(id: string): Promise<Session> {
  const { supabase, user } = await requireLearner();
  const { data, error } = await supabase.from("study_sessions").select("*").eq("id", id).eq("user_id", user.id).single();
  if (error) throw new Error("Could not confirm the session version. Reload to recover.");
  return data as Session;
}

export async function completePractice(id: string, version: number, intervals: unknown) {
  const { supabase } = await requireLearner();
  if (!isUuid(id) || !Number.isInteger(version) || !validIntervals(intervals)) return { error: "Invalid timing. Your draft is kept." };
  const { error } = await supabase.rpc("complete_practice_session", { p_session_id: id, p_version: version, p_intervals: intervals });
  if (error) return { error: error.code === "40001" ? "This draft changed elsewhere. Reload before finishing." : "This session does not yet have the required stored evidence. Complete its practice and feedback, or close unfinished." };
  revalidatePath("/"); revalidatePath("/session"); revalidatePath("/review");
  return { completed: true };
}
