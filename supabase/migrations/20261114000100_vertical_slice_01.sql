-- Undeployed initial migration. Apply through the version-controlled Supabase CLI workflow.
begin;

create function public.valid_active_intervals(value jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item jsonb; previous_end numeric := 0; start_ms numeric; end_ms numeric;
begin
  if jsonb_typeof(value) <> 'array' or jsonb_array_length(value) > 10000 then return false; end if;
  for item in select * from jsonb_array_elements(value) loop
    if jsonb_typeof(item->'start') is distinct from 'number' or jsonb_typeof(item->'end') is distinct from 'number' then return false; end if;
    start_ms := (item->>'start')::numeric; end_ms := (item->>'end')::numeric;
    if start_ms < previous_end or end_ms < start_ms or end_ms > 8640000000000000 then return false; end if;
    previous_end := end_ms;
  end loop;
  return true;
end;
$$;

create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  local_date date not null,
  session_type text not null check (session_type in ('learning', 'review')),
  planned_words smallint not null default 2 check (planned_words = 2),
  chosen_words smallint not null default 2 check (chosen_words between 1 and 3),
  exceptional_learning boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'closed_incomplete', 'completed')),
  closed_at timestamptz,
  intervals jsonb not null default '[]' check (public.valid_active_intervals(intervals)),
  draft jsonb not null default '{}' check (jsonb_typeof(draft) = 'object' and octet_length(draft::text) <= 200000),
  version integer not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  check ((status = 'draft' and closed_at is null) or (status <> 'draft' and closed_at is not null)),
  check (session_type <> 'learning' or extract(dow from local_date) not in (5,6) or exceptional_learning)
);
create unique index one_active_draft_per_learner on public.study_sessions(user_id) where status = 'draft';
create index sessions_history on public.study_sessions(user_id, created_at desc);

create function public.guard_study_session()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- No routine completion evidence exists in slice 01. A later migration must
  -- implement evidence-aware completion before ANY caller can use this state.
  if new.status = 'completed' then
    raise exception 'Routine completion is not implemented; close as incomplete instead' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.closed_at is not null or new.version <> 0 then
      raise exception 'Sessions must begin as active drafts' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.id is distinct from old.id
    or new.local_date is distinct from old.local_date or new.session_type is distinct from old.session_type
    or new.created_at is distinct from old.created_at then
    raise exception 'Session identity cannot change' using errcode = '23514';
  end if;
  if old.status <> 'draft' then
    raise exception 'Closed sessions are read-only' using errcode = '55000';
  end if;
  if new.chosen_words < (select count(*) from public.words where session_id = old.id and user_id = old.user_id) then
    raise exception 'Selected count cannot be less than saved words' using errcode = '23514', constraint = 'session_word_limit';
  end if;
  if new.status = 'closed_incomplete' then
    new.closed_at := clock_timestamp();
  end if;
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger guard_study_session before insert or update on public.study_sessions
  for each row execute function public.guard_study_session();

create table public.words (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  target text not null check (length(btrim(target)) between 1 and 100),
  normalized_key text generated always as (lower(btrim(target))) stored,
  learn_date date not null,
  meaning text not null check (length(btrim(meaning)) between 1 and 5000),
  part_of_speech text not null check (part_of_speech in ('noun','verb','adjective','adverb','other')),
  source_example text not null check (length(btrim(source_example)) between 1 and 5000),
  source_url text not null check (source_url ~ '^https?://' and length(source_url) <= 5000),
  context text not null default '' check (length(context) <= 5000),
  word_family text not null default '' check (length(word_family) <= 5000),
  synonym text not null default '' check (length(synonym) <= 5000),
  first_sentence text not null check (length(btrim(first_sentence)) between 1 and 5000),
  feedback_state text not null default 'not_requested' check (feedback_state = 'not_requested'),
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.study_sessions(id, user_id),
  unique (user_id, normalized_key)
);
create index words_chronological on public.words(user_id, learn_date desc, created_at desc);
create index words_session on public.words(session_id);

create function public.enforce_session_word_limit()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare s public.study_sessions;
begin
  -- All insert paths, including direct table inserts, WRITE the parent row.
  -- This serializes inserts, count reductions and closing on one row lock.
  -- The write also forces a serialization failure for stale repeatable-read
  -- snapshots; a lock-only count check would not provide that guarantee.
  update public.study_sessions set version = version
    where id = new.session_id and user_id = new.user_id and user_id = auth.uid() and status = 'draft'
    returning * into s;
  if not found then
    raise exception 'An owned active draft is required' using errcode = '42501';
  end if;
  if (select count(*) from public.words where session_id = s.id and user_id = s.user_id) >= s.chosen_words then
    raise exception 'Selected session word count has been reached' using errcode = '23514', constraint = 'session_word_limit';
  end if;
  return new;
end;
$$;
create trigger enforce_session_word_limit before insert on public.words
  for each row execute function public.enforce_session_word_limit();

create function public.preserve_first_sentence()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.first_sentence is distinct from old.first_sentence then
    raise exception 'The first sentence is immutable learner evidence';
  end if;
  return new;
end;
$$;
create trigger preserve_first_sentence before update on public.words
  for each row execute function public.preserve_first_sentence();

alter table public.study_sessions enable row level security;
alter table public.words enable row level security;
create policy sessions_select on public.study_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy sessions_insert on public.study_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy sessions_update on public.study_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy words_select on public.words for select to authenticated using ((select auth.uid()) = user_id);
create policy words_insert on public.words for insert to authenticated with check (
  (select auth.uid()) = user_id and exists (
    select 1 from public.study_sessions s where s.id = session_id and s.user_id = (select auth.uid())
    and s.status = 'draft'
    and ((s.session_type = 'learning' and extract(dow from learn_date) not in (5,6)) or s.exceptional_learning)
  )
);
revoke all on public.study_sessions, public.words from anon, authenticated;
grant select, insert, update on public.study_sessions to authenticated;
-- No update/delete policy or grant for words: original records stay intact.
grant select, insert on public.words to authenticated;

-- Race-safe get-or-create. The partial unique index is the final arbiter;
-- a read-then-insert in application code alone cannot prevent duplicate drafts.
create function public.start_study_session(p_local_date date, p_exceptional boolean default false)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare session_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_local_date is null or p_exceptional is null then raise exception 'Session settings are required' using errcode = '23514'; end if;
  loop
    insert into public.study_sessions(user_id, local_date, session_type, exceptional_learning)
      values (auth.uid(), p_local_date, case when extract(dow from p_local_date) in (5,6) and not p_exceptional then 'review' else 'learning' end, p_exceptional)
      on conflict (user_id) where status = 'draft' do nothing returning id into session_id;
    exit when found;
    select id into session_id from public.study_sessions where user_id = auth.uid() and status = 'draft' for update;
    exit when found;
    -- The conflicting draft may have closed between the insert and read.
  end loop;
  -- Both exits have an owned, non-null session ID. Keeping the return outside
  -- the retry loop also makes the scalar return path explicit to static lint.
  return session_id;
end;
$$;

-- Store the final unsaved text and confirmed timing in the same transaction as
-- closing. Closed sessions keep all words and become immutable history.
create function public.close_study_session(p_session_id uuid, p_version integer, p_draft jsonb, p_intervals jsonb, p_chosen_words integer, p_exceptional boolean)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.study_sessions;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_version is null or p_version < 0 then raise exception 'A valid session version is required' using errcode = '23514'; end if;
  select * into s from public.study_sessions where id = p_session_id and user_id = auth.uid() for update;
  if not found then raise exception 'Session not found' using errcode = '42501'; end if;
  if s.status = 'closed_incomplete' then
    if s.draft = p_draft and s.intervals = p_intervals and s.chosen_words = p_chosen_words and s.exceptional_learning = p_exceptional then
      return s.id; -- identical lost-response retry; never overwrite closed history
    end if;
    raise exception 'Session already closed with different work; keep your local copy' using errcode = '55000';
  end if;
  if s.status <> 'draft' then raise exception 'Session is not an active draft' using errcode = '55000'; end if;
  if s.version <> p_version then raise exception 'Draft changed elsewhere. Reload to recover.' using errcode = '40001'; end if;
  update public.study_sessions set draft = p_draft, intervals = p_intervals, chosen_words = p_chosen_words,
    exceptional_learning = p_exceptional, status = 'closed_incomplete' where id = s.id;
  return s.id;
end;
$$;

-- Atomic save: immutable word insert + clearing its draft. SECURITY INVOKER retains RLS.
create function public.save_session_word(p_session_id uuid, p_version integer, p_word jsonb, p_intervals jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.study_sessions; existing public.words; word_id uuid := (p_word->>'id')::uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_version is null or p_version < 0 then raise exception 'A valid session version is required' using errcode = '23514'; end if;
  select * into s from public.study_sessions where id = p_session_id and user_id = auth.uid() for update;
  if not found then raise exception 'Session not found' using errcode = '42501'; end if;
  -- Retry after a lost response returns the same record, without rewriting the original.
  select * into existing from public.words where id = word_id and user_id = auth.uid() and session_id = p_session_id;
  if found then return existing.id; end if;
  if s.status <> 'draft' then raise exception 'Session is closed' using errcode = '55000'; end if;
  if s.version <> p_version then raise exception 'Draft changed in another tab. Reload to recover.' using errcode = '40001'; end if;
  if (s.session_type <> 'learning' or extract(dow from (p_word->>'learn_date')::date) in (5,6)) and not s.exceptional_learning then raise exception 'Choose exceptional learning first' using errcode = '42501'; end if;
  insert into public.words (id, user_id, session_id, target, learn_date, meaning, part_of_speech, source_example, source_url, context, word_family, synonym, first_sentence)
  values (word_id, auth.uid(), s.id, p_word->>'target', (p_word->>'learn_date')::date, p_word->>'meaning', p_word->>'part_of_speech', p_word->>'source_example', p_word->>'source_url', coalesce(p_word->>'context',''), coalesce(p_word->>'word_family',''), coalesce(p_word->>'synonym',''), p_word->>'first_sentence');
  update public.study_sessions set draft = '{}', intervals = p_intervals where id = s.id;
  return word_id;
end;
$$;
revoke all on function public.save_session_word(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_session_word(uuid, integer, jsonb, jsonb) to authenticated;
revoke all on function public.start_study_session(date, boolean) from public, anon;
grant execute on function public.start_study_session(date, boolean) to authenticated;
revoke all on function public.close_study_session(uuid, integer, jsonb, jsonb, integer, boolean) from public, anon;
grant execute on function public.close_study_session(uuid, integer, jsonb, jsonb, integer, boolean) to authenticated;
commit;
