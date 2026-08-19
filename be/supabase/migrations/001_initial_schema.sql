-- ============================================================
-- VNR_gameQuiz — Initial Schema
-- Migration: 001_initial_schema.sql
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ============================================================
-- GAMES
-- ============================================================
create table if not exists public.games (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  status        text not null default 'waiting'  -- waiting | active | finished
                check (status in ('waiting', 'active', 'finished')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- GAME QUESTIONS
-- ============================================================
create table if not exists public.game_questions (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references public.games(id) on delete cascade,
  question_text    text not null,
  question_type    text not null default 'multiple_choice'
                   check (question_type in ('multiple_choice', 'data_story')),
  time_limit_sec   int  not null default 30,
  points_max       int  not null default 1000,
  order_index      int  not null default 0,
  explanation      text,
  source_url       text,
  source_label     text,
  created_at       timestamptz not null default now()
);

create index idx_game_questions_game_id on public.game_questions(game_id);
create index idx_game_questions_order   on public.game_questions(game_id, order_index);

-- ============================================================
-- QUESTION OPTIONS  (is_correct is NEVER exposed to frontend)
-- ============================================================
create table if not exists public.question_options (
  id                uuid primary key default gen_random_uuid(),
  game_question_id  uuid not null references public.game_questions(id) on delete cascade,
  option_text       text not null,
  option_label      char(1) not null check (option_label in ('A','B','C','D')),
  is_correct        boolean not null default false,  -- READ ONLY by service role
  display_order     int not null default 0,
  created_at        timestamptz not null default now()
);

create index idx_question_options_question_id on public.question_options(game_question_id);

-- ============================================================
-- QUESTION DATA  (JSONB chart data for Data Story questions)
-- ============================================================
create table if not exists public.question_data (
  id                uuid primary key default gen_random_uuid(),
  game_question_id  uuid not null references public.game_questions(id) on delete cascade,
  chart_type        text not null default 'BAR'
                    check (chart_type in ('LINE', 'BAR', 'AREA')),
  data              jsonb not null default '[]',   -- array of { label, value, ... }
  x_label           text,
  y_label           text,
  created_at        timestamptz not null default now()
);

-- ============================================================
-- GAME PLAYERS
-- ============================================================
create table if not exists public.game_players (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references public.games(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  nickname         text not null,
  avatar_url       text,
  score            int  not null default 0,
  correct_answers  int  not null default 0,
  current_streak   int  not null default 0,
  best_streak      int  not null default 0,
  rank             int,
  joined_at        timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  unique (game_id, user_id)
);

create index idx_game_players_game_score on public.game_players(game_id, score desc);

-- ============================================================
-- PLAYER ANSWERS
-- Duplicate prevention: UNIQUE(game_player_id, game_question_id)
-- ============================================================
create table if not exists public.player_answers (
  id                  uuid primary key default gen_random_uuid(),
  game_player_id      uuid not null references public.game_players(id) on delete cascade,
  game_question_id    uuid not null references public.game_questions(id) on delete cascade,
  selected_option_id  uuid references public.question_options(id) on delete set null,
  is_correct          boolean not null default false,
  points_earned       int  not null default 0,
  response_time_ms    int  not null default 0,
  answered_at         timestamptz not null default now(),

  -- This constraint prevents duplicate submissions at the DB level
  unique (game_player_id, game_question_id)
);

create index idx_player_answers_player on public.player_answers(game_player_id);
create index idx_player_answers_question on public.player_answers(game_question_id);

-- ============================================================
-- TIMELINE EVENTS
-- ============================================================
create table if not exists public.timeline_events (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  event_date   date not null,
  description  text,
  category     text,
  source_url   text,
  image_url    text,
  created_at   timestamptz not null default now()
);

create index idx_timeline_events_date on public.timeline_events(event_date);

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_games_updated_at
  before update on public.games
  for each row execute function public.set_updated_at();

create trigger trg_game_players_updated_at
  before update on public.game_players
  for each row execute function public.set_updated_at();
