-- Slice 02 post-deployment verification for Supabase CLI --remote --read-only.
-- The CLI's supabase_read_only_user cannot execute review_attempt_is_complete(uuid)
-- or SELECT from review_schedule (which invokes that function).
-- Read the underlying evidence tables instead; do not change grants or migrations.
-- All violation counts below must be ZERO. Visibility counts are informational:
-- compare them with your pre-deployment snapshot (at least 1 word, 5 milestones).
-- This checks stored evidence and schema; authenticated browser/runtime tests
-- separately verify the review_schedule view and application behavior.
WITH attempt_evidence AS (
  SELECT
    a.id, a.user_id, a.session_id, a.word_id, a.scheduled_date,
    a.requires_sentence,
    (r.attempt_id IS NOT NULL) AS revealed,
    (f.attempt_id IS NOT NULL) AS acknowledged,
    (p.attempt_id IS NOT NULL) AS has_production,
    f.acknowledged_at,
    f.actual_date AS feedback_date,
    (
      r.attempt_id IS NOT NULL
      AND f.attempt_id IS NOT NULL
      AND (NOT a.requires_sentence OR p.attempt_id IS NOT NULL)
    ) AS fully_checked
  FROM public.review_attempts a
  LEFT JOIN public.review_reveals r
    ON r.attempt_id = a.id AND r.user_id = a.user_id
  LEFT JOIN public.review_feedback f
    ON f.attempt_id = a.id AND f.user_id = a.user_id
  LEFT JOIN public.review_productions p
    ON p.attempt_id = a.id AND p.user_id = a.user_id
),
obligation_evidence AS (
  SELECT o.kind, o.checkpoint, a.fully_checked, a.has_production,
         a.revealed, a.acknowledged, a.acknowledged_at, a.feedback_date
  FROM public.review_obligations o
  LEFT JOIN attempt_evidence a
    ON a.word_id = o.word_id AND a.user_id = o.user_id
   AND a.scheduled_date = o.due_date
)
SELECT jsonb_build_object(
  'check_role', current_user,
  'migration_versions',
    (SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),
  'visible_words', (SELECT count(*) FROM public.words),
  'visible_review_obligations', (SELECT count(*) FROM public.review_obligations),
  'words_without_exact_milestones',
    (SELECT count(*) FROM public.words w WHERE
      (SELECT array_agg(o.checkpoint ORDER BY o.checkpoint)
       FROM public.review_obligations o
       WHERE o.word_id = w.id AND o.user_id = w.user_id AND o.kind = 'milestone')
      IS DISTINCT FROM ARRAY[1,3,7,14,30]::smallint[]),
  'incorrect_due_dates',
    (SELECT count(*) FROM public.review_obligations o
     JOIN public.words w ON w.id = o.word_id
     WHERE o.kind = 'milestone'
       AND (o.user_id <> w.user_id OR o.due_date <> w.learn_date + o.checkpoint)),
  'tables_missing_rls',
    (SELECT count(*) FROM pg_catalog.pg_class
     WHERE oid IN (
       'public.study_sessions'::regclass, 'public.words'::regclass,
       'public.review_obligations'::regclass, 'public.review_attempts'::regclass,
       'public.review_productions'::regclass, 'public.review_feedback'::regclass,
       'public.review_reveals'::regclass)
       AND NOT relrowsecurity),
  'review_schedule_not_security_invoker',
    (SELECT count(*) FROM pg_catalog.pg_class c
     WHERE c.oid = 'public.review_schedule'::regclass
       AND NOT (COALESCE(c.reloptions, ARRAY[]::text[]) @> ARRAY['security_invoker=true']::text[])),
  'authenticated_missing_completion_execute',
    CASE WHEN has_function_privilege('authenticated',
      'public.review_attempt_is_complete(uuid)', 'EXECUTE') THEN 0 ELSE 1 END,
  'anon_has_completion_execute',
    CASE WHEN has_function_privilege('anon',
      'public.review_attempt_is_complete(uuid)', 'EXECUTE') THEN 1 ELSE 0 END,
  'completed_day7_without_production',
    (SELECT count(*) FROM obligation_evidence
     WHERE checkpoint = 7 AND fully_checked AND NOT has_production),
  'acknowledged_attempts_missing_required_evidence',
    (SELECT count(*) FROM attempt_evidence
     WHERE acknowledged AND
       (NOT revealed OR (requires_sentence AND NOT has_production)
        OR acknowledged_at IS NULL OR feedback_date IS NULL)),
  'completed_sessions_with_unchecked_attempts',
    (SELECT count(*) FROM public.study_sessions s
     JOIN attempt_evidence a ON a.session_id = s.id AND a.user_id = s.user_id
     WHERE s.status = 'completed' AND NOT a.fully_checked),
  'official_attempt_duplicates',
    (SELECT count(*) FROM (
       SELECT word_id, scheduled_date FROM public.review_attempts
       WHERE scheduled_date IS NOT NULL
       GROUP BY word_id, scheduled_date HAVING count(*) > 1
     ) duplicate_attempts)
) AS verification;
