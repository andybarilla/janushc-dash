-- name: CreateScribeUsageEvent :one
INSERT INTO scribe_usage_events (
    session_id, event_type, provider, operation, model_id, external_job_id,
    audio_duration_seconds, billable_duration_seconds,
    input_tokens, output_tokens, total_tokens,
    estimated_cost_micros, actual_cost_micros, currency,
    pricing_source, rate_snapshot, metadata
) VALUES (
    ?1, ?2, ?3, ?4, ?5, ?6,
    ?7, ?8,
    ?9, ?10, ?11,
    ?12, ?13, ?14,
    ?15, ?16, ?17
)
RETURNING *;

-- name: ListScribeUsageEventsForSession :many
SELECT *
FROM scribe_usage_events
WHERE session_id = ?1
ORDER BY created_at ASC;

-- name: GetScribeUsageSummaryForSession :one
WITH session_usage_events AS (
    SELECT *
    FROM scribe_usage_events
    WHERE session_id = ?1
)
SELECT
    CAST(COUNT(*) AS integer) AS event_count,
    CAST(COALESCE(SUM(estimated_cost_micros), 0) AS bigint) AS total_estimated_cost_micros,
    (
        SELECT total_actual_cost_micros
        FROM (
            SELECT NULL AS total_actual_cost_micros
            WHERE NOT EXISTS (SELECT 1 FROM session_usage_events WHERE actual_cost_micros IS NOT NULL)
            UNION ALL
            SELECT CAST(SUM(actual_cost_micros) AS bigint) AS total_actual_cost_micros
            FROM session_usage_events
            WHERE actual_cost_micros IS NOT NULL
        ) actual_cost_summary
        LIMIT 1
    ) AS total_actual_cost_micros,
    (SUM(audio_duration_seconds) FILTER (WHERE event_type = 'transcription')) AS transcription_audio_duration_seconds,
    (
        SELECT transcription_billable_duration_seconds
        FROM (
            SELECT NULL AS transcription_billable_duration_seconds
            WHERE NOT EXISTS (SELECT 1 FROM session_usage_events WHERE event_type = 'transcription' AND billable_duration_seconds IS NOT NULL)
            UNION ALL
            SELECT CAST(SUM(billable_duration_seconds) AS bigint) AS transcription_billable_duration_seconds
            FROM session_usage_events
            WHERE event_type = 'transcription' AND billable_duration_seconds IS NOT NULL
        ) billable_duration_summary
        LIMIT 1
    ) AS transcription_billable_duration_seconds,
    COALESCE(SUM(estimated_cost_micros) FILTER (WHERE event_type = 'transcription'), 0) AS transcription_estimated_cost_micros,
    (
        SELECT transcription_actual_cost_micros
        FROM (
            SELECT NULL AS transcription_actual_cost_micros
            WHERE NOT EXISTS (SELECT 1 FROM session_usage_events WHERE event_type = 'transcription' AND actual_cost_micros IS NOT NULL)
            UNION ALL
            SELECT CAST(SUM(actual_cost_micros) AS bigint) AS transcription_actual_cost_micros
            FROM session_usage_events
            WHERE event_type = 'transcription' AND actual_cost_micros IS NOT NULL
        ) transcription_actual_cost_summary
        LIMIT 1
    ) AS transcription_actual_cost_micros,
    CASE WHEN COUNT(DISTINCT provider) FILTER (WHERE event_type = 'transcription') = 1 THEN MIN(provider) FILTER (WHERE event_type = 'transcription')
         WHEN COUNT(*) FILTER (WHERE event_type = 'transcription') > 1 THEN 'multiple'
         ELSE NULL END AS transcription_provider,
    CASE WHEN COUNT(DISTINCT operation) FILTER (WHERE event_type = 'transcription') = 1 THEN MIN(operation) FILTER (WHERE event_type = 'transcription')
         WHEN COUNT(*) FILTER (WHERE event_type = 'transcription') > 1 THEN 'multiple'
         ELSE NULL END AS transcription_operation,
    COALESCE(SUM(input_tokens) FILTER (WHERE event_type = 'llm'), 0) AS llm_input_tokens,
    COALESCE(SUM(output_tokens) FILTER (WHERE event_type = 'llm'), 0) AS llm_output_tokens,
    COALESCE(SUM(total_tokens) FILTER (WHERE event_type = 'llm'), 0) AS llm_total_tokens,
    COALESCE(SUM(estimated_cost_micros) FILTER (WHERE event_type = 'llm'), 0) AS llm_estimated_cost_micros,
    (
        SELECT llm_actual_cost_micros
        FROM (
            SELECT NULL AS llm_actual_cost_micros
            WHERE NOT EXISTS (SELECT 1 FROM session_usage_events WHERE event_type = 'llm' AND actual_cost_micros IS NOT NULL)
            UNION ALL
            SELECT CAST(SUM(actual_cost_micros) AS bigint) AS llm_actual_cost_micros
            FROM session_usage_events
            WHERE event_type = 'llm' AND actual_cost_micros IS NOT NULL
        ) llm_actual_cost_summary
        LIMIT 1
    ) AS llm_actual_cost_micros,
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
    CAST(COUNT(*) FILTER (WHERE actual_cost_micros IS NOT NULL) AS integer) AS actual_event_count
FROM session_usage_events;
