-- ============================================================
-- Nebula Mail - Iteration 2 Migration
-- Safe / additive migration. Does NOT replace existing tables
-- or delete existing data. Genuinely idempotent — safe to re-run.
--
-- Layers on top of the existing tables:
-- users, oauth_tokens, threads, emails, agent_tool_calls, saved_filters
-- None of those are modified except two new nullable columns on `emails`.
-- ============================================================

-- 1. Email form metadata
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS has_form boolean DEFAULT false;

ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS form_url text;


-- 2. Conversations
-- NOTE: user_id is NOT NULL because a conversation should always
-- belong to someone. If your current auth flow ever creates a
-- conversation row before the authenticated user is resolved,
-- relax this back to nullable and enforce ownership purely in
-- the backend instead — don't force this through blindly.
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);


-- 3. Messages
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid
    REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  role text NOT NULL
    CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  tool_calls jsonb,
  tool_results jsonb,
  citations jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
ON public.messages(conversation_id, created_at);


-- 4. Form fill sessions
CREATE TABLE IF NOT EXISTS public.form_fill_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  email_id text
    REFERENCES public.emails(id) ON DELETE CASCADE,
  form_type text NOT NULL
    CHECK (form_type IN ('pdf', 'google_form', 'ms_form', 'other')),
  fields jsonb NOT NULL,
  status text DEFAULT 'draft'
    CHECK (
      status IN (
        'draft',
        'pending_approval',
        'submitted',
        'rejected',
        'failed'
      )
    ),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);


-- 5. Feedback
CREATE TABLE IF NOT EXISTS public.feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL
    REFERENCES public.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);


-- 6. Link agent tool calls to conversations (only after confirming
--    the conversations table above already exists)
ALTER TABLE public.agent_tool_calls
  ADD COLUMN IF NOT EXISTS conversation_id uuid
  REFERENCES public.conversations(id) ON DELETE SET NULL;


-- 7. Useful indexes (inspect existing indexes first, avoid duplicates)
CREATE INDEX IF NOT EXISTS emails_user_received_idx
ON public.emails(user_id, received_at DESC);

CREATE INDEX IF NOT EXISTS emails_user_folder_idx
ON public.emails(user_id, folder);

CREATE INDEX IF NOT EXISTS emails_user_unread_idx
ON public.emails(user_id, is_unread);

CREATE INDEX IF NOT EXISTS emails_thread_idx
ON public.emails(thread_id);

CREATE INDEX IF NOT EXISTS threads_user_last_message_idx
ON public.threads(user_id, last_message_at DESC);


-- 8. RLS
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.form_fill_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;


-- 9. RLS Policies
-- Genuinely idempotent: each block checks pg_policies first and only
-- creates the policy if it doesn't already exist, so this migration
-- can be re-run safely without a "policy already exists" error.

DO $$
BEGIN

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversations'
      AND policyname = 'Users manage their own conversations'
  ) THEN
    CREATE POLICY "Users manage their own conversations"
    ON public.conversations
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'messages'
      AND policyname = 'Users manage their own messages'
  ) THEN
    CREATE POLICY "Users manage their own messages"
    ON public.messages
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'form_fill_sessions'
      AND policyname = 'Users manage their own form fill sessions'
  ) THEN
    CREATE POLICY "Users manage their own form fill sessions"
    ON public.form_fill_sessions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'feedback'
      AND policyname = 'Users manage their own feedback'
  ) THEN
    CREATE POLICY "Users manage their own feedback"
    ON public.feedback
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;

END
$$;

-- ============================================================
-- Notes:
-- - emails.embedding (pgvector) already exists from the original schema
--   and is reused as-is for citation/RAG retrieval — no new vector
--   column or second vector database is created here.
-- - RLS on `messages` only checks the row's own user_id. The backend
--   must additionally verify authenticated_user_id == message.user_id
--   == conversation.user_id (join through `conversations`) before
--   reading/writing conversation history — don't rely on RLS alone here.
-- ============================================================
