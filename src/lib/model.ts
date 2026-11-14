export const AWL_SOURCE = "https://ieltstutors.org/academic-word-list/";
export const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb", "other"] as const;
export type WordInput = {
  id: string;
  target: string;
  learn_date: string;
  meaning: string;
  part_of_speech: string;
  source_example: string;
  source_url: string;
  context: string;
  word_family: string;
  synonym: string;
  first_sentence: string;
};
export type Interval = { start: number; end: number };
export type WordDraft = Partial<WordInput> & { stage?: "notes" | "sentence" };
export type Session = {
  id: string;
  user_id: string;
  local_date: string;
  session_type: "learning" | "review";
  planned_words: number;
  chosen_words: number;
  exceptional_learning: boolean;
  status: "draft" | "closed_incomplete" | "completed";
  closed_at: string | null;
  intervals: Interval[];
  draft: WordDraft;
  version: number;
  updated_at: string;
};
export type Word = WordInput & { user_id: string; session_id: string; created_at: string };

// Call with the current time only in browser effects/events, never while
// prerendering. The default is the learner's browser-configured IANA timezone.
export function localDate(date = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function isReviewDay(date: string) {
  // A learning date is already a local calendar date; don't reinterpret it
  // using the timezone of the server that validates it.
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day === 5 || day === 6;
}
export function emptyWord(): WordInput {
  return { id: crypto.randomUUID(), target: "", learn_date: localDate(), meaning: "", part_of_speech: "noun", source_example: "", source_url: AWL_SOURCE, context: "", word_family: "", synonym: "", first_sentence: "" };
}
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateWord(value: unknown): WordInput {
  if (!value || typeof value !== "object") throw new Error("Enter your word details.");
  const word = value as WordInput;
  if (!isUuid(word.id) || !validDate(word.learn_date)) throw new Error("Invalid word or learning date.");
  const required = ["target", "meaning", "part_of_speech", "source_example", "source_url", "first_sentence"] as const;
  const optional = ["context", "word_family", "synonym"] as const;
  for (const field of [...required, ...optional]) {
    if (typeof word[field] !== "string" || word[field].length > (field === "target" ? 100 : 5000) || (required.includes(field as typeof required[number]) && !word[field].trim())) {
      throw new Error(`Check ${field.replaceAll("_", " ")} (maximum ${field === "target" ? 100 : 5000} characters).`);
    }
  }
  if (!PARTS_OF_SPEECH.includes(word.part_of_speech as typeof PARTS_OF_SPEECH[number])) throw new Error("Choose a part of speech.");
  let url: URL;
  try { url = new URL(word.source_url); } catch { throw new Error("Enter a valid source URL."); }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Source must be an HTTP or HTTPS link.");
  // Intentionally preserve every character of the learner's sentence.
  return Object.fromEntries(["id", "learn_date", ...required, ...optional].map(key => [key, word[key as keyof WordInput]])) as WordInput;
}
