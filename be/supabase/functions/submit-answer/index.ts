// @ts-nocheck — Deno / Supabase Edge Function runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};


interface SubmitAnswerPayload {
  game_id: string;
  game_question_id: string;
  selected_option_id: string;
  response_time_ms: number;
}

interface AnswerResult {
  correct: boolean;
  points_earned: number;
  streak: number;
  correct_answer_text: string;
  correct_option_label: string;
  explanation: string | null;
  source_url: string | null;
  source_label: string | null;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth: extract JWT from Authorization header ─────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonError(401, "Missing Authorization header");
    }

    // Service-role client (has access to is_correct — never returned to client)
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // User client — used to verify the JWT and get user_id
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authHeader } },
        auth: { autoRefreshToken: false, persistSession: false },
      }
    );

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return jsonError(401, "Unauthorized");
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const body: SubmitAnswerPayload = await req.json();
    const { game_id, game_question_id, selected_option_id, response_time_ms } =
      body;

    if (!game_id || !game_question_id || !selected_option_id) {
      return jsonError(400, "Missing required fields");
    }

    // ── Resolve game_player_id ────────────────────────────────────────────────
    const { data: playerRow, error: playerErr } = await serviceClient
      .from("game_players")
      .select("id, current_streak, best_streak")
      .eq("game_id", game_id)
      .eq("user_id", user.id)
      .single();

    if (playerErr || !playerRow) {
      return jsonError(404, "Player not found in this game");
    }

    const game_player_id = playerRow.id;

    // ── Duplicate prevention check ────────────────────────────────────────────
    const { data: existingAnswer } = await serviceClient
      .from("player_answers")
      .select("id")
      .eq("game_player_id", game_player_id)
      .eq("game_question_id", game_question_id)
      .maybeSingle();

    if (existingAnswer) {
      return jsonError(409, "Answer already submitted for this question");
    }

    // ── Fetch question details (points_max, time_limit_sec, explanation, source)
    const { data: question, error: qErr } = await serviceClient
      .from("game_questions")
      .select(
        "points_max, time_limit_sec, explanation, source_url, source_label"
      )
      .eq("id", game_question_id)
      .single();

    if (qErr || !question) {
      return jsonError(404, "Question not found");
    }

    // ── Fetch all options for this question (including is_correct) ────────────
    const { data: options, error: optErr } = await serviceClient
      .from("question_options")
      .select("id, option_text, option_label, is_correct")
      .eq("game_question_id", game_question_id);

    if (optErr || !options || options.length === 0) {
      return jsonError(500, "Could not load question options");
    }

    // ── Check correctness (SERVER SIDE ONLY) ─────────────────────────────────
    const selectedOption = options.find((o) => o.id === selected_option_id);
    if (!selectedOption) {
      return jsonError(400, "Invalid option id");
    }

    const isCorrect: boolean = selectedOption.is_correct;
    const correctOption = options.find((o) => o.is_correct) ?? selectedOption;

    // ── Points calculation with time bonus ────────────────────────────────────
    // Full points if answered instantly, decreasing linearly to 50% at time limit
    const timeLimitMs = question.time_limit_sec * 1000;
    const clampedTime = Math.min(response_time_ms, timeLimitMs);
    const elapsedRatio = clampedTime / timeLimitMs;
    const pointsEarned = isCorrect
      ? Math.round(question.points_max * (1 - elapsedRatio * 0.5))
      : 0;

    // ── Update streak ─────────────────────────────────────────────────────────
    const newStreak = isCorrect ? playerRow.current_streak + 1 : 0;
    const newBestStreak = Math.max(playerRow.best_streak, newStreak);

    // ── Persist answer ────────────────────────────────────────────────────────
    const { error: insertErr } = await serviceClient
      .from("player_answers")
      .insert({
        game_player_id,
        game_question_id,
        selected_option_id,
        is_correct: isCorrect,
        points_earned: pointsEarned,
        response_time_ms: clampedTime,
      });

    if (insertErr) {
      // Unique constraint violation = duplicate (race condition safety net)
      if (insertErr.code === "23505") {
        return jsonError(409, "Answer already submitted for this question");
      }
      return jsonError(500, "Failed to save answer: " + insertErr.message);
    }

    // ── Update player score & streak ──────────────────────────────────────────
    await serviceClient
      .from("game_players")
      .update({
        score: `score + ${pointsEarned}`,  // raw SQL via rpc preferred; this is fine for Edge Function
        correct_answers: isCorrect
          ? `correct_answers + 1`
          : `correct_answers`,
        current_streak: newStreak,
        best_streak: newBestStreak,
      })
      .eq("id", game_player_id);

    // Recalc using RPC to avoid race conditions on score increment
    await serviceClient.rpc("increment_player_score", {
      p_player_id: game_player_id,
      p_points: pointsEarned,
      p_correct: isCorrect,
      p_new_streak: newStreak,
      p_new_best_streak: newBestStreak,
    });

    // ── Return result (NO is_correct field from DB, only derived boolean) ─────
    const result: AnswerResult = {
      correct: isCorrect,
      points_earned: pointsEarned,
      streak: newStreak,
      correct_answer_text: correctOption.option_text,
      correct_option_label: correctOption.option_label,
      explanation: question.explanation,
      source_url: question.source_url,
      source_label: question.source_label,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err) {
    console.error("submit-answer error:", err);
    return jsonError(500, "Internal server error");
  }
});

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
