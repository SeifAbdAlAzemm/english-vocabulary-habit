-- Read-only baseline. Keep output locally and compare after migration, before
-- recording new learner activity. This does not print words or sentence text.
-- CLI v3 db query prepares one statement: keep checks in a single SELECT.
select jsonb_build_object(
  'words', (select jsonb_build_object('count',count(*),'digest',
    md5(coalesce(string_agg(id::text || ':' || row_to_json(w)::text, E'\n' order by id),''))) from public.words w),
  'original_sentences', (select md5(coalesce(string_agg(id::text || ':' || first_sentence,E'\n' order by id),'')) from public.words),
  'sessions', (select jsonb_build_object('count',count(*),'digest',
    md5(coalesce(string_agg(id::text || ':' || (to_jsonb(s)-array['mvd_path','mvd_targets'])::text,E'\n' order by id),''))) from public.study_sessions s)
) as evidence_snapshot;
