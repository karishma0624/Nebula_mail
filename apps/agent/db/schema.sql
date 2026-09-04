-- ============================================================
-- Nebula Mail — Supabase Schema (PostgreSQL + pgvector)
-- ============================================================

-- Enable pgcrypto (for gen_random_uuid if needed) and vector extension
create extension if not exists pgcrypto;
create extension if not exists vector;

-- ============================================================
-- USERS & OAUTH
-- ============================================================

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  created_at timestamptz default now()
);

create table if not exists oauth_tokens (
  user_id uuid references users(id) on delete cascade,
  provider text not null default 'google',
  access_token text not null,
  refresh_token text not null,
  scope text not null,
  expiry timestamptz not null,
  primary key (user_id, provider)
);

-- ============================================================
-- CACHED MAIL (Gmail stays source of truth; read cache & search index)
-- ============================================================

create table if not exists threads (
  id text primary key,               -- gmail thread id
  user_id uuid references users(id) on delete cascade,
  subject text,
  snippet text,
  participants text[],
  last_message_at timestamptz,
  is_unread boolean default true
);

-- NOTE ON EMBEDDING DIMENSION:
-- Gemini's standard embedding model (e.g. text-embedding-004) generates 768-dimensional vectors.
-- Dimension is set to 768 to match the Gemini embedding model selected for Step 7.
create table if not exists emails (
  id text primary key,               -- gmail message id
  thread_id text references threads(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  sender text not null,
  recipients text[] not null,
  subject text,
  body_text text,
  body_html text,
  snippet text,
  folder text check (folder in ('inbox','sent','draft')) not null,
  is_unread boolean default true,
  received_at timestamptz not null,
  embedding vector(768)
);

create index if not exists emails_user_folder_idx on emails(user_id, folder, received_at desc);
create index if not exists emails_embedding_idx on emails using ivfflat (embedding vector_cosine_ops);

-- ============================================================
-- ASSISTANT AUDIT TRAIL
-- ============================================================

create table if not exists agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  tool_name text not null,
  arguments jsonb not null,
  result jsonb,
  status text check (status in ('pending_approval','approved','executed','failed','rejected')),
  created_at timestamptz default now()
);

-- ============================================================
-- SAVED / LAST-USED FILTERS
-- ============================================================

create table if not exists saved_filters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  label text,
  criteria jsonb not null,           -- {date_from, date_to, sender, keyword, unread_only}
  created_at timestamptz default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- Each policy matches that table's actual user-identifying column.
-- users has no user_id column, so it uses id = auth.uid() instead.
-- ============================================================

alter table users enable row level security;
alter table oauth_tokens enable row level security;
alter table threads enable row level security;
alter table emails enable row level security;
alter table agent_tool_calls enable row level security;
alter table saved_filters enable row level security;

-- Drop existing policies if updating to prevent duplicate policy errors
drop policy if exists "users_self_access" on users;
create policy "users_self_access"
  on users for all
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "oauth_tokens_self_access" on oauth_tokens;
create policy "oauth_tokens_self_access"
  on oauth_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "threads_self_access" on threads;
create policy "threads_self_access"
  on threads for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "emails_self_access" on emails;
create policy "emails_self_access"
  on emails for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "agent_tool_calls_self_access" on agent_tool_calls;
create policy "agent_tool_calls_self_access"
  on agent_tool_calls for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "saved_filters_self_access" on saved_filters;
create policy "saved_filters_self_access"
  on saved_filters for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
