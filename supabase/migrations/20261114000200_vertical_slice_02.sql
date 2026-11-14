-- Additive review engine. The deployed Slice 01 migration is unchanged.
begin;

alter table public.words add constraint words_id_owner unique (id, user_id);
alter table public.study_sessions drop constraint study_sessions_session_type_check;
alter table public.study_sessions add constraint study_sessions_session_type_check check (session_type in ('learning','review','MVD'));
alter table public.study_sessions add column mvd_path text check (mvd_path in ('due','extra','learn'));
alter table public.study_sessions add column mvd_targets uuid[] not null default '{}';

create table public.review_obligations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word_id uuid not null,
  kind text not null check (kind in ('milestone','remedial')),
  checkpoint smallint,
  due_date date not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (word_id,user_id) references public.words(id,user_id) on delete cascade,
  check ((kind = 'milestone' and checkpoint in (1,3,7,14,30)) or (kind = 'remedial' and checkpoint is null)),
  check (kind <> 'milestone' or checkpoint is not null)
);
create unique index milestone_once on public.review_obligations(word_id,checkpoint) where kind = 'milestone';
create unique index remedial_once on public.review_obligations(word_id,due_date) where kind = 'remedial';
create index reviews_due on public.review_obligations(user_id,due_date,word_id);

create table public.review_attempts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  word_id uuid not null,
  scheduled_date date, -- NULL means extra practice; never an official denominator.
  recall text not null check (recall in ('remembered','forgot')),
  attempted_at timestamptz not null default clock_timestamp(),
  actual_date date not null,
  timezone text not null,
  was_late boolean generated always as (scheduled_date is not null and actual_date > scheduled_date) stored,
  requires_sentence boolean not null,
  foreign key (word_id,user_id) references public.words(id,user_id) on delete cascade,
  foreign key (session_id,user_id) references public.study_sessions(id,user_id) on delete cascade,
  unique (id,user_id)
);
create unique index official_first_attempt on public.review_attempts(word_id,scheduled_date) where scheduled_date is not null;
create index review_session on public.review_attempts(session_id,user_id);

create table public.review_productions (
  attempt_id uuid primary key,
  user_id uuid not null,
  first_sentence text not null check (length(btrim(first_sentence)) between 1 and 5000),
  evaluation_state text not null default 'pending_evaluation' check (evaluation_state = 'pending_evaluation'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (attempt_id,user_id) references public.review_attempts(id,user_id) on delete cascade
);
create table public.review_feedback (
  attempt_id uuid primary key,
  user_id uuid not null,
  session_id uuid not null,
  foreign key (session_id,user_id) references public.study_sessions(id,user_id) on delete cascade,
  acknowledged_at timestamptz not null default clock_timestamp(),
  actual_date date not null,
  foreign key (attempt_id,user_id) references public.review_attempts(id,user_id) on delete cascade
);
create table public.review_reveals (
  attempt_id uuid primary key,
  user_id uuid not null,
  revealed_at timestamptz not null default clock_timestamp(),
  foreign key (attempt_id,user_id) references public.review_attempts(id,user_id) on delete cascade
);

-- Client roles can read only owned evidence. Writes go through small, audited
-- RPCs, each checking auth.uid(), ownership and the active parent session lock.
alter table public.review_obligations enable row level security;
alter table public.review_attempts enable row level security;
alter table public.review_productions enable row level security;
alter table public.review_feedback enable row level security;
alter table public.review_reveals enable row level security;
create policy obligations_owner on public.review_obligations for select to authenticated using ((select auth.uid()) = user_id);
create policy attempts_owner on public.review_attempts for select to authenticated using ((select auth.uid()) = user_id);
create policy productions_owner on public.review_productions for select to authenticated using ((select auth.uid()) = user_id);
create policy feedback_owner on public.review_feedback for select to authenticated using ((select auth.uid()) = user_id);
create policy reveals_owner on public.review_reveals for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.review_obligations,public.review_attempts,public.review_productions,public.review_feedback from anon,authenticated;
grant select on public.review_obligations,public.review_attempts,public.review_productions,public.review_feedback to authenticated;
revoke all on public.review_reveals from anon,authenticated;
grant select on public.review_reveals to authenticated;

create function public.reject_review_evidence_change() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Review evidence is immutable' using errcode = '23514';
end;
$$;
create trigger obligations_immutable before update on public.review_obligations for each row execute function public.reject_review_evidence_change();
create trigger attempts_immutable before update on public.review_attempts for each row execute function public.reject_review_evidence_change();
create trigger productions_immutable before update on public.review_productions for each row execute function public.reject_review_evidence_change();
create trigger feedback_immutable before update on public.review_feedback for each row execute function public.reject_review_evidence_change();
create trigger reveals_immutable before update on public.review_reveals for each row execute function public.reject_review_evidence_change();

create function public.schedule_word_reviews() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.review_obligations(user_id,word_id,kind,checkpoint,due_date)
    select new.user_id,new.id,'milestone',n,new.learn_date+n from unnest(array[1,3,7,14,30]) n
    on conflict do nothing;
  return new;
end;
$$;
create trigger schedule_word_reviews after insert on public.words for each row execute function public.schedule_word_reviews();

-- A repeatable, owner-scoped repair operation; no word/session updates.
create function public.backfill_review_obligations() returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.review_obligations(user_id,word_id,kind,checkpoint,due_date)
    select w.user_id,w.id,'milestone',n,w.learn_date+n from public.words w cross join unnest(array[1,3,7,14,30]) n
    where w.user_id = auth.uid() on conflict do nothing;
end;
$$;
-- Deployment backfills every existing owner's words, including closed history.
insert into public.review_obligations(user_id,word_id,kind,checkpoint,due_date)
  select w.user_id,w.id,'milestone',n,w.learn_date+n from public.words w cross join unnest(array[1,3,7,14,30]) n
  on conflict do nothing;

-- Shared completion gate for obligations, session evidence and future metrics.
-- Saving recall/production alone never completes the retrieval-feedback cycle.
create function public.review_attempt_is_complete(p_attempt_id uuid) returns boolean
language sql stable security invoker set search_path = '' as $$
  select exists (
    select 1 from public.review_attempts a
    join public.review_reveals r on r.attempt_id=a.id and r.user_id=a.user_id
    join public.review_feedback f on f.attempt_id=a.id and f.user_id=a.user_id
    left join public.review_productions p on p.attempt_id=a.id and p.user_id=a.user_id
    where a.id=p_attempt_id and (not a.requires_sentence or p.attempt_id is not null)
  )
$$;
revoke all on function public.review_attempt_is_complete(uuid) from public,anon;
grant execute on function public.review_attempt_is_complete(uuid) to authenticated;

-- One official card per word/date can satisfy coinciding milestone/remedial
-- obligations. All remain due until the entire card's feedback is checked.
create view public.review_schedule with (security_invoker = true) as
select o.*, w.target,w.part_of_speech, a.id as attempt_id,a.recall,a.actual_date,a.attempted_at,a.was_late,
  public.review_attempt_is_complete(a.id) as completed,
  p.first_sentence,p.evaluation_state,
  case when public.review_attempt_is_complete(a.id) then f.acknowledged_at end as completed_at,
  case when public.review_attempt_is_complete(a.id) then f.actual_date end as completed_date,
  case when public.review_attempt_is_complete(a.id) then f.actual_date>o.due_date end as completion_was_late,
  (o.kind='milestone' and public.review_attempt_is_complete(a.id)) as milestone_metric_eligible
from public.review_obligations o join public.words w on w.id=o.word_id and w.user_id=o.user_id
left join public.review_attempts a on a.word_id=o.word_id and a.user_id=o.user_id and a.scheduled_date=o.due_date
left join public.review_productions p on p.attempt_id=a.id and p.user_id=o.user_id
left join public.review_feedback f on f.attempt_id=a.id and f.user_id=o.user_id;
revoke all on public.review_schedule from anon,authenticated;
grant select on public.review_schedule to authenticated;

create function public.learner_today(p_timezone text) returns date language plpgsql stable set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then
    raise exception 'Choose a valid IANA timezone' using errcode = '23514';
  end if;
  return (statement_timestamp() at time zone p_timezone)::date;
end;
$$;

create function public.session_has_completion_evidence(p_id uuid) returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select
    not exists (select 1 from public.review_attempts a where a.session_id=s.id and a.user_id=s.user_id
      and not public.review_attempt_is_complete(a.id))
    and case
    when s.session_type='learning' then false
    when s.session_type='review' then
      not exists (select 1 from public.words w where w.session_id=s.id) and
      exists (select 1 from public.review_attempts a join public.review_feedback f on f.attempt_id=a.id
        where f.session_id=s.id and a.actual_date=s.local_date and f.actual_date=s.local_date
        and public.review_attempt_is_complete(a.id))
      and not exists (select 1 from public.review_schedule r where r.user_id=s.user_id and r.due_date<=s.local_date and not r.completed)
    when s.mvd_path='learn' then exists (select 1 from public.words w where w.session_id=s.id and w.learn_date=s.local_date)
    when s.mvd_path='due' then cardinality(s.mvd_targets)>0 and not exists (
      select 1 from unnest(s.mvd_targets) target where not exists (
        select 1 from public.review_attempts a join public.review_feedback f on f.attempt_id=a.id
        where f.session_id=s.id and a.word_id=target and a.scheduled_date is not null
        and a.actual_date=s.local_date and f.actual_date=s.local_date and public.review_attempt_is_complete(a.id)))
    when s.mvd_path='extra' then (
      select count(distinct a.word_id)>=2 or (count(distinct a.word_id)>=1 and bool_or(p.attempt_id is not null))
      from public.review_attempts a join public.review_feedback f on f.attempt_id=a.id
      left join public.review_productions p on p.attempt_id=a.id
      where f.session_id=s.id and a.scheduled_date is null and a.word_id=any(s.mvd_targets)
      and a.actual_date=s.local_date and f.actual_date=s.local_date and public.review_attempt_is_complete(a.id))
    else false end from public.study_sessions s where s.id=p_id and s.user_id=auth.uid()),false)
$$;

create or replace function public.guard_study_session() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if new.status<>'draft' or new.closed_at is not null or new.version<>0 then
      raise exception 'Sessions must begin as active drafts' using errcode='23514';
    end if;
    new.mvd_path := null; new.mvd_targets := '{}';
    if new.session_type='MVD' then
      select array_agg(q.word_id order by q.due_date,q.word_id) into new.mvd_targets from (
        select r.word_id,min(r.due_date) due_date from public.review_schedule r
        where r.user_id=new.user_id and r.due_date<=new.local_date and not r.completed
        group by r.word_id order by min(r.due_date),r.word_id limit 2) q;
      if cardinality(new.mvd_targets)>0 then new.mvd_path:='due';
      else
        select array_agg(id order by learn_date,id) into new.mvd_targets from public.words where user_id=new.user_id;
        new.mvd_path:=case when cardinality(new.mvd_targets)>0 then 'extra' else 'learn' end;
      end if;
      new.mvd_targets:=coalesce(new.mvd_targets,'{}');
      new.chosen_words:=1;
    end if;
    return new;
  end if;
  if new.user_id is distinct from old.user_id or new.id is distinct from old.id or new.local_date is distinct from old.local_date
    or new.session_type is distinct from old.session_type or new.created_at is distinct from old.created_at
    or new.mvd_path is distinct from old.mvd_path or new.mvd_targets is distinct from old.mvd_targets then
    raise exception 'Session identity cannot change' using errcode='23514';
  end if;
  if new.status='completed' and not public.session_has_completion_evidence(old.id) then
    raise exception 'Stored completion evidence is missing' using errcode='23514';
  end if;
  if old.status<>'draft' then raise exception 'Closed sessions are read-only' using errcode='55000'; end if;
  if new.chosen_words<(select count(*) from public.words where session_id=old.id and user_id=old.user_id) then
    raise exception 'Selected count cannot be less than saved words' using errcode='23514',constraint='session_word_limit';
  end if;
  if new.status<>'draft' then new.closed_at:=clock_timestamp(); end if;
  new.version:=old.version+1; new.updated_at:=clock_timestamp();
  return new;
end;
$$;

create function public.start_practice_session(p_mode text,p_timezone text,p_exceptional boolean default false)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid; today date:=public.learner_today(p_timezone); typ text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_mode is null or p_mode not in ('routine','review','MVD') or p_exceptional is null then raise exception 'Invalid session mode' using errcode='23514'; end if;
  typ:=case when p_mode='routine' then case when extract(dow from today) in (5,6) and not p_exceptional then 'review' else 'learning' end else p_mode end;
  loop
    insert into public.study_sessions(user_id,local_date,session_type,exceptional_learning) values(auth.uid(),today,typ,p_exceptional)
      on conflict(user_id) where status='draft' do nothing returning id into result;
    exit when found;
    select id into result from public.study_sessions where user_id=auth.uid() and status='draft' for update;
    exit when found;
  end loop;
  return result;
end;
$$;

-- Retain the existing invoker save RPC and trigger protections. Extend its
-- learning permission only for the first-day, one-word MVD path.
drop policy words_insert on public.words;
create policy words_insert on public.words for insert to authenticated with check (
  user_id=(select auth.uid()) and exists(select 1 from public.study_sessions s where s.id=session_id and s.user_id=(select auth.uid()) and s.status='draft'
    and ((s.session_type='learning' and extract(dow from learn_date) not in (5,6)) or s.exceptional_learning
      or (s.session_type='MVD' and s.mvd_path='learn' and learn_date=s.local_date)))
);

create function public.guard_slice02_word() returns trigger language plpgsql set search_path = '' as $$
declare s public.study_sessions;
begin
  select * into s from public.study_sessions where id=new.session_id and user_id=new.user_id;
  if s.session_type='learning' and exists(select 1 from public.review_schedule where user_id=new.user_id and due_date<=s.local_date and not completed) then
    raise exception 'Review due words before new-word entry' using errcode='23514';
  end if;
  if s.session_type='MVD' and (s.mvd_path<>'learn' or new.learn_date<>s.local_date or exists(select 1 from public.words where session_id=s.id)) then
    raise exception 'MVD learning permits one first-day word' using errcode='23514';
  end if;
  return new;
end;
$$;
-- Alphabetical trigger order: the existing enforce_session_word_limit writes
-- and locks the parent before this guard reads evidence.
create trigger slice02_word_guard before insert on public.words for each row execute function public.guard_slice02_word();

-- Same original save body with the one narrowly extended MVD permission.
create or replace function public.save_session_word(p_session_id uuid,p_version integer,p_word jsonb,p_intervals jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.study_sessions; existing public.words; word_id uuid:=(p_word->>'id')::uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_version is null or p_version<0 then raise exception 'A valid session version is required' using errcode='23514'; end if;
  select * into s from public.study_sessions where id=p_session_id and user_id=auth.uid() for update;
  if not found then raise exception 'Session not found' using errcode='42501'; end if;
  select * into existing from public.words where id=word_id and user_id=auth.uid() and session_id=p_session_id;
  if found then return existing.id; end if;
  if s.status<>'draft' then raise exception 'Session is closed' using errcode='55000'; end if;
  if s.version<>p_version then raise exception 'Draft changed elsewhere' using errcode='40001'; end if;
  if not (s.session_type='MVD' and s.mvd_path='learn') and (s.session_type<>'learning' or extract(dow from (p_word->>'learn_date')::date) in (5,6)) and not s.exceptional_learning then
    raise exception 'Choose exceptional learning first' using errcode='42501';
  end if;
  insert into public.words(id,user_id,session_id,target,learn_date,meaning,part_of_speech,source_example,source_url,context,word_family,synonym,first_sentence)
    values(word_id,auth.uid(),s.id,p_word->>'target',(p_word->>'learn_date')::date,p_word->>'meaning',p_word->>'part_of_speech',p_word->>'source_example',p_word->>'source_url',coalesce(p_word->>'context',''),coalesce(p_word->>'word_family',''),coalesce(p_word->>'synonym',''),p_word->>'first_sentence');
  update public.study_sessions set draft='{}',intervals=p_intervals where id=s.id;
  return word_id;
end;
$$;

create function public.record_review(p_id uuid,p_session_id uuid,p_version integer,p_word_id uuid,p_scheduled_date date,p_recall text,p_sentence text,p_timezone text,p_intervals jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.study_sessions; a public.review_attempts; needs_sentence boolean; today date:=public.learner_today(p_timezone);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into s from public.study_sessions where id=p_session_id and user_id=auth.uid() for update;
  if not found then raise exception 'Session not found' using errcode='42501'; end if;
  -- Serialize official cards across sessions as well as within this session.
  perform 1 from public.words where id=p_word_id and user_id=auth.uid() for update;
  if not found then raise exception 'Word not found' using errcode='42501'; end if;
  select * into a from public.review_attempts where user_id=auth.uid() and
    (id=p_id or (word_id=p_word_id and scheduled_date=p_scheduled_date)) order by attempted_at limit 1;
  if found then
    if a.word_id<>p_word_id or a.scheduled_date is distinct from p_scheduled_date then raise exception 'Attempt identity conflict' using errcode='23514'; end if;
    return a.id; -- Immutable first result; missing production has a separate RPC.
  end if;
  if s.status<>'draft' then raise exception 'Session is closed' using errcode='55000'; end if;
  if p_version is null or s.version<>p_version then raise exception 'Draft changed elsewhere' using errcode='40001'; end if;
  if p_scheduled_date is not null and (p_scheduled_date>today or not exists(select 1 from public.review_obligations where word_id=p_word_id and user_id=auth.uid() and due_date=p_scheduled_date)) then
    raise exception 'Review is not due' using errcode='23514';
  end if;
  needs_sentence:=exists(select 1 from public.review_obligations where word_id=p_word_id and due_date=p_scheduled_date and checkpoint=7);
  insert into public.review_attempts(id,user_id,session_id,word_id,scheduled_date,recall,actual_date,timezone,requires_sentence)
    values(p_id,auth.uid(),s.id,p_word_id,p_scheduled_date,p_recall,today,p_timezone,needs_sentence);
  if p_sentence is not null then
    insert into public.review_productions(attempt_id,user_id,first_sentence) values(p_id,auth.uid(),p_sentence);
  end if;
  if p_recall='forgot' then
    insert into public.review_obligations(user_id,word_id,kind,due_date) values(auth.uid(),p_word_id,'remedial',today+1) on conflict do nothing;
  end if;
  update public.study_sessions set intervals=p_intervals where id=s.id;
  return p_id;
end;
$$;

create function public.finish_review_feedback(p_attempt_id uuid,p_session_id uuid,p_version integer,p_sentence text,p_acknowledge boolean,p_timezone text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.review_attempts; s public.study_sessions; today date:=public.learner_today(p_timezone);
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into a from public.review_attempts where id=p_attempt_id and user_id=auth.uid();
  if not found then raise exception 'Attempt not found' using errcode='42501'; end if;
  select * into s from public.study_sessions where id=p_session_id and user_id=auth.uid() for update;
  if not found then raise exception 'Session not found' using errcode='42501'; end if;
  if p_version is null or s.version<>p_version then raise exception 'Draft changed elsewhere' using errcode='40001'; end if;
  if s.status<>'draft' then raise exception 'Session is closed' using errcode='55000'; end if;
  perform 1 from public.review_attempts where id=a.id for update;
  if p_sentence is not null then
    if exists(select 1 from public.review_reveals where attempt_id=a.id) and not exists(select 1 from public.review_productions where attempt_id=a.id) then
      raise exception 'A first independent sentence must precede answer reveal' using errcode='23514';
    end if;
    insert into public.review_productions(attempt_id,user_id,first_sentence) values(a.id,auth.uid(),p_sentence) on conflict do nothing;
  end if;
  if p_acknowledge then
    if not exists(select 1 from public.review_reveals where attempt_id=a.id) then
      raise exception 'Reveal and check the answer first' using errcode='23514';
    end if;
    if a.requires_sentence and not exists(select 1 from public.review_productions where attempt_id=a.id) then
      raise exception 'Independent Day +7 sentence is still required' using errcode='23514';
    end if;
    insert into public.review_feedback(attempt_id,user_id,session_id,actual_date) values(a.id,auth.uid(),s.id,today) on conflict do nothing;
  end if;
  update public.study_sessions set version=version where id=s.id;
end;
$$;

create function public.reveal_review_answer(p_attempt_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.review_attempts; answer jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into a from public.review_attempts where id=p_attempt_id and user_id=auth.uid() for update;
  if not found then raise exception 'Save a first recall before revealing' using errcode='42501'; end if;
  if a.requires_sentence and not exists(select 1 from public.review_productions where attempt_id=a.id) then
    raise exception 'Save the independent Day +7 sentence first' using errcode='23514';
  end if;
  insert into public.review_reveals(attempt_id,user_id) values(a.id,auth.uid()) on conflict do nothing;
  select jsonb_build_object('target',target,'meaning',meaning,'source_example',source_example) into answer
    from public.words where id=a.word_id and user_id=auth.uid();
  return answer;
end;
$$;

create function public.complete_practice_session(p_session_id uuid,p_version integer,p_intervals jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare s public.study_sessions;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into s from public.study_sessions where id=p_session_id and user_id=auth.uid() for update;
  if not found then raise exception 'Session not found' using errcode='42501'; end if;
  if s.status='completed' then return s.id; end if;
  if p_version is null or s.version<>p_version then raise exception 'Draft changed elsewhere' using errcode='40001'; end if;
  update public.study_sessions set status='completed',intervals=p_intervals where id=s.id;
  return s.id;
end;
$$;

revoke all on function public.schedule_word_reviews(),public.reject_review_evidence_change(),public.guard_slice02_word() from public,anon,authenticated;
revoke all on function public.backfill_review_obligations(),public.learner_today(text),public.session_has_completion_evidence(uuid),public.start_practice_session(text,text,boolean),public.record_review(uuid,uuid,integer,uuid,date,text,text,text,jsonb),public.finish_review_feedback(uuid,uuid,integer,text,boolean,text),public.complete_practice_session(uuid,integer,jsonb) from public,anon;
grant execute on function public.backfill_review_obligations(),public.learner_today(text),public.session_has_completion_evidence(uuid),public.start_practice_session(text,text,boolean),public.record_review(uuid,uuid,integer,uuid,date,text,text,text,jsonb),public.finish_review_feedback(uuid,uuid,integer,text,boolean,text),public.complete_practice_session(uuid,integer,jsonb) to authenticated;
revoke all on function public.reveal_review_answer(uuid) from public,anon;
grant execute on function public.reveal_review_answer(uuid) to authenticated;
commit;
