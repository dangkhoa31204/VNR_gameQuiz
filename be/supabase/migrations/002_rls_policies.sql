-- ============================================================
-- VNR_gameQuiz — Row Level Security Policies
-- Migration: 002_rls_policies.sql
-- ============================================================

-- Enable RLS on all tables
alter table public.games           enable row level security;
alter table public.game_questions  enable row level security;
alter table public.question_options enable row level security;
alter table public.question_data   enable row level security;
alter table public.game_players    enable row level security;
alter table public.player_answers  enable row level security;
alter table public.timeline_events enable row level security;

-- ============================================================
-- GAMES — public read, no client writes
-- ============================================================
create policy "games: public read"
  on public.games for select
  using (true);

-- ============================================================
-- GAME QUESTIONS — public read
-- ============================================================
create policy "game_questions: public read"
  on public.game_questions for select
  using (true);

-- ============================================================
-- QUESTION OPTIONS — public read BUT is_correct is never in
-- the returned columns (enforced via a security-definer view)
-- ============================================================
create policy "question_options: public read (no is_correct)"
  on public.question_options for select
  using (true);

-- Create a secure view that strips is_correct for client use.
-- Clients should query this view, never the base table directly.
create or replace view public.question_options_safe
  with (security_invoker = true)
as
  select
    id,
    game_question_id,
    option_text,
    option_label,
    display_order,
    created_at
  -- is_correct intentionally omitted
  from public.question_options;

-- ============================================================
-- QUESTION DATA — public read
-- ============================================================
create policy "question_data: public read"
  on public.question_data for select
  using (true);

-- ============================================================
-- GAME PLAYERS — public read; users can insert/update own row
-- ============================================================
create policy "game_players: public read"
  on public.game_players for select
  using (true);

create policy "game_players: authenticated insert own"
  on public.game_players for insert
  with check (auth.uid() = user_id);

create policy "game_players: authenticated update own"
  on public.game_players for update
  using (auth.uid() = user_id);

-- ============================================================
-- PLAYER ANSWERS — users can only read their own answers
-- Write access is ONLY via the service role (Edge Function)
-- ============================================================
create policy "player_answers: read own"
  on public.player_answers for select
  using (
    game_player_id in (
      select id from public.game_players
      where user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for player role.
-- All writes go through the Edge Function (service_role key).

-- ============================================================
-- TIMELINE EVENTS — public read
-- ============================================================
create policy "timeline_events: public read"
  on public.timeline_events for select
  using (true);
