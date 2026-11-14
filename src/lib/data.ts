import type { SupabaseClient } from "@supabase/supabase-js";
import type { Word } from "./model";

export async function loadWords(client: SupabaseClient, userId: string): Promise<Word[]> {
  const { data, error } = await client.from("words").select("*").eq("user_id", userId).order("learn_date", { ascending: false }).order("created_at", { ascending: false });
  if (error) throw new Error("Words could not be loaded. Check your connection and apply the database migration.");
  return data as Word[];
}
