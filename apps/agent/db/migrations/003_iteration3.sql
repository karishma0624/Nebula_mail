-- ============================================================
-- Nebula Mail - Iteration 3 Migration
-- Safe / additive migration for Restricted Senders, Views,
-- Meeting Drafts, and Agent Errors Taxonomy.
-- ============================================================

-- Confidential/restricted contacts
create table if not exists public.restricted_senders (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  email_address text not null,
  label text,
  created_at timestamp with time zone default now(),
  constraint restricted_senders_pkey primary key (id),
  constraint restricted_senders_user_id_fkey foreign key (user_id) references public.users(id),
  constraint restricted_senders_unique unique (user_id, email_address)
);

alter table public.restricted_senders enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'restricted_senders' and policyname = 'restricted_senders_owner_only'
  ) then
    create policy restricted_senders_owner_only on public.restricted_senders
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Normalize on write: lowercase + trim, so comparisons are always clean
create or replace function public.normalize_restricted_sender() returns trigger as $$
begin
  new.email_address := lower(trim(new.email_address));
  return new;
end;
$$ language plpgsql;

drop trigger if exists restricted_senders_normalize on public.restricted_senders;
create trigger restricted_senders_normalize
  before insert or update on public.restricted_senders
  for each row execute function public.normalize_restricted_sender();

update public.restricted_senders
set email_address = lower(trim(email_address))
where email_address is not null;

-- Single enforcement point: participant-based, case-insensitive, message-level
create or replace view public.agent_visible_emails
with (security_invoker = true) as
select e.*
from public.emails e
where not exists (
  select 1
  from public.restricted_senders rs
  where rs.user_id = e.user_id
    and (
      rs.email_address = lower(trim(e.sender))
      or exists (
        select 1 from unnest(e.recipients) as addr
        where lower(trim(addr)) = rs.email_address
      )
    )
);

-- Same protection for attachment RAG
create or replace view public.agent_visible_attachments
with (security_invoker = true) as
select a.*
from public.email_attachments a
join public.agent_visible_emails ve on ve.id = a.email_id;

-- Meeting scheduling
create table if not exists public.meeting_drafts (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  start_time timestamp with time zone not null,
  end_time timestamp with time zone not null,
  attendees text[] not null,
  email_draft_id text,
  meet_link text,
  calendar_event_id text,
  status text not null default 'pending_approval'
    check (status = ANY (ARRAY['pending_approval'::text,'approved'::text,'created'::text,'failed'::text,'rejected'::text])),
  created_at timestamp with time zone default now(),
  constraint meeting_drafts_pkey primary key (id),
  constraint meeting_drafts_user_id_fkey foreign key (user_id) references public.users(id)
);

alter table public.meeting_drafts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'meeting_drafts' and policyname = 'meeting_drafts_owner_only'
  ) then
    create policy meeting_drafts_owner_only on public.meeting_drafts
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Structured error taxonomy
create table if not exists public.agent_errors (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  request_id uuid not null,
  error_type text not null
    check (error_type = ANY (ARRAY[
      'input_error'::text,'intent_error'::text,'planner_error'::text,'tool_error'::text,
      'retriever_error'::text,'memory_error'::text,'prompt_error'::text,'reasoning_error'::text,
      'output_error'::text,'deployment_error'::text
    ])),
  component text not null,
  message text not null,
  raw_context jsonb,
  created_at timestamp with time zone default now(),
  constraint agent_errors_pkey primary key (id),
  constraint agent_errors_user_id_fkey foreign key (user_id) references public.users(id)
);

alter table public.agent_errors enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'agent_errors' and policyname = 'agent_errors_owner_only'
  ) then
    create policy agent_errors_owner_only on public.agent_errors
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Request tracing on the existing audit table
alter table public.agent_tool_calls add column if not exists request_id uuid;
create index if not exists agent_tool_calls_request_id_idx on public.agent_tool_calls(request_id);
