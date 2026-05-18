-- name: CreateScribeUsageEvent :one
INSERT INTO scribe_usage_events (
    session_id, event_type, provider, operation, model_id, external_job_id,
    audio_duration_seconds, billable_duration_seconds,
    input_tokens, output_tokens, total_tokens,
    estimated_cost_micros, actual_cost_micros, currency,
    pricing_source, rate_snapshot, metadata
) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8,
    $9, $10, $11,
    $12, $13, $14,
    $15, $16, $17
)
RETURNING *;

-- name: ListScribeUsageEventsForSession :many
SELECT *
FROM scribe_usage_events
WHERE session_id = $1
ORDER BY created_at ASC;

-- name: GetScribeUsageSummaryForSession :one
SELECT
    COUNT(*)::int AS event_count,
    COALESCE(SUM(estimated_cost_micros), 0)::bigint AS total_estimated_cost_micros,
    (SUM(actual_cost_micros) FILTER (WHERE actual_cost_micros IS NOT NULL))::numeric AS total_actual_cost_micros,
    (SUM(audio_duration_seconds) FILTER (WHERE event_type = 'transcription'))::numeric AS transcription_audio_duration_seconds,
    (SUM(billable_duration_seconds) FILTER (WHERE event_type = 'transcription'))::numeric AS transcription_billable_duration_seconds,
    COALESCE(SUM(estimated_cost_micros) FILTER (WHERE event_type = 'transcription'), 0)::bigint AS transcription_estimated_cost_micros,
    (SUM(actual_cost_micros) FILTER (WHERE event_type = 'transcription' AND actual_cost_micros IS NOT NULL))::numeric AS transcription_actual_cost_micros,
    CASE WHEN COUNT(DISTINCT provider) FILTER (WHERE event_type = 'transcription') = 1 THEN MIN(provider) FILTER (WHERE event_type = 'transcription')
         WHEN COUNT(*) FILTER (WHERE event_type = 'transcription') > 1 THEN 'multiple'
         ELSE NULL END AS transcription_provider,
    CASE WHEN COUNT(DISTINCT operation) FILTER (WHERE event_type = 'transcription') = 1 THEN MIN(operation) FILTER (WHERE event_type = 'transcription')
         WHEN COUNT(*) FILTER (WHERE event_type = 'transcription') > 1 THEN 'multiple'
         ELSE NULL END AS transcription_operation,
    COALESCE(SUM(input_tokens) FILTER (WHERE event_type = 'llm'), 0)::bigint AS llm_input_tokens,
    COALESCE(SUM(output_tokens) FILTER (WHERE event_type = 'llm'), 0)::bigint AS llm_output_tokens,
    COALESCE(SUM(total_tokens) FILTER (WHERE event_type = 'llm'), 0)::bigint AS llm_total_tokens,
    COALESCE(SUM(estimated_cost_micros) FILTER (WHERE event_type = 'llm'), 0)::bigint AS llm_estimated_cost_micros,
    (SUM(actual_cost_micros) FILTER (WHERE event_type = 'llm' AND actual_cost_micros IS NOT NULL))::numeric AS llm_actual_cost_micros,
    CASE WHEN COUNT(DISTINCT provider) FILTER (WHERE event_type = 'llm') = 1 THEN MIN(provider) FILTER (WHERE event_type = 'llm')
         WHEN COUNT(*) FILTER (WHERE event_type = 'llm') > 1 THEN 'multiple'
         ELSE NULL END AS llm_provider,
    CASE WHEN COUNT(DISTINCT operation) FILTER (WHERE event_type = 'llm') = 1 THEN MIN(operation) FILTER (WHERE event_type = 'llm')
         WHEN COUNT(*) FILTER (WHERE event_type = 'llm') > 1 THEN 'multiple'
         ELSE NULL END AS llm_operation,
    CASE WHEN COUNT(*) FILTER (WHERE event_type = 'llm') > 0
          AND COUNT(model_id) FILTER (WHERE event_type = 'llm') = COUNT(*) FILTER (WHERE event_type = 'llm')
          AND COUNT(DISTINCT model_id) FILTER (WHERE event_type = 'llm') = 1
         THEN MIN(model_id) FILTER (WHERE event_type = 'llm')
         ELSE NULL END AS llm_model_id,
    COUNT(*) FILTER (WHERE actual_cost_micros IS NOT NULL)::int AS actual_event_count
FROM scribe_usage_events
WHERE session_id = $1;
