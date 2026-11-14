export type ReviewItem = {
  id: string; word_id: string; kind: "milestone" | "remedial";
  checkpoint: number | null; due_date: string; target: string; part_of_speech: string;
  attempt_id: string | null; completed: boolean;
};
export type ReviewCard = { key: string; word_id: string; target: string; part_of_speech: string; due_date: string | null; obligations: ReviewItem[] };
export type ReviewAttempt = {
  id: string; word_id: string; scheduled_date: string | null; recall: "remembered" | "forgot";
  actual_date: string; was_late: boolean; requires_sentence: boolean;
  review_productions: { first_sentence: string; evaluation_state: string }[];
  review_feedback: { actual_date: string }[];
};
export type ReviewState = { today: string; queue: ReviewCard[]; oldWords: { id: string; target: string; part_of_speech: string }[]; attempts: ReviewAttempt[]; qualified: boolean };

export function reviewCards(items: ReviewItem[]): ReviewCard[] {
  const cards = new Map<string, ReviewCard>();
  for (const item of items) {
    const key = `${item.word_id}:${item.due_date}`;
    if (!cards.has(key)) cards.set(key, { key, word_id: item.word_id, target: item.target, part_of_speech: item.part_of_speech, due_date: item.due_date, obligations: [] });
    cards.get(key)!.obligations.push(item);
  }
  return [...cards.values()].sort((a, b) => a.due_date!.localeCompare(b.due_date!) || a.target.localeCompare(b.target));
}
