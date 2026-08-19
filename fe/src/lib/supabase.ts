import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Database types (mirrors schema) ──────────────────────────────────────────

export type GameStatus = 'waiting' | 'active' | 'finished'
export type QuestionType = 'multiple_choice' | 'data_story'
export type ChartType = 'LINE' | 'BAR' | 'AREA'

export interface Game {
  id: string
  title: string
  description: string | null
  status: GameStatus
  created_at: string
  updated_at: string
}

export interface GameQuestion {
  id: string
  game_id: string
  question_text: string
  question_type: QuestionType
  time_limit_sec: number
  points_max: number
  order_index: number
  explanation: string | null
  source_url: string | null
  source_label: string | null
  created_at: string
}

/** Safe view — is_correct is intentionally omitted */
export interface QuestionOptionSafe {
  id: string
  game_question_id: string
  option_text: string
  option_label: 'A' | 'B' | 'C' | 'D'
  display_order: number
  created_at: string
}

export interface QuestionData {
  id: string
  game_question_id: string
  chart_type: ChartType
  data: Array<{ label: string; value: number; [key: string]: unknown }>
  x_label: string | null
  y_label: string | null
  created_at: string
}

export interface GamePlayer {
  id: string
  game_id: string
  user_id: string | null
  nickname: string
  avatar_url: string | null
  score: number
  correct_answers: number
  current_streak: number
  best_streak: number
  rank: number | null
  joined_at: string
  updated_at: string
}

export interface PlayerAnswer {
  id: string
  game_player_id: string
  game_question_id: string
  selected_option_id: string | null
  is_correct: boolean
  points_earned: number
  response_time_ms: number
  answered_at: string
}

export interface TimelineEvent {
  id: string
  title: string
  event_date: string
  description: string | null
  category: string | null
  source_url: string | null
  image_url: string | null
  created_at: string
}

// ─── Edge Function response types ─────────────────────────────────────────────

export interface SubmitAnswerPayload {
  game_id: string
  game_question_id: string
  selected_option_id: string
  response_time_ms: number
}

export interface SubmitAnswerResult {
  correct: boolean
  points_earned: number
  streak: number
  correct_answer_text: string
  correct_option_label: string
  explanation: string | null
  source_url: string | null
  source_label: string | null
}

// ─── Helper: call the submit-answer Edge Function ─────────────────────────────

export async function submitAnswer(
  payload: SubmitAnswerPayload
): Promise<SubmitAnswerResult> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token

  if (!token) throw new Error('User not authenticated')

  const res = await fetch(
    `${supabaseUrl}/functions/v1/submit-answer`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify(payload),
    }
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }

  return res.json() as Promise<SubmitAnswerResult>
}
