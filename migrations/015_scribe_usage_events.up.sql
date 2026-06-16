CREATE TABLE scribe_usage_events (
    id UUID PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))),
    session_id UUID NOT NULL REFERENCES scribe_sessions(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('transcription', 'llm')),
    provider TEXT NOT NULL,
    operation TEXT NOT NULL,
    model_id TEXT,
    external_job_id TEXT,
    audio_duration_seconds NUMERIC(12,3),
    billable_duration_seconds INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    estimated_cost_micros BIGINT NOT NULL DEFAULT 0,
    actual_cost_micros BIGINT,
    currency TEXT NOT NULL DEFAULT 'USD',
    pricing_source TEXT NOT NULL DEFAULT 'configured_rate',
    rate_snapshot JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scribe_usage_events_session ON scribe_usage_events (session_id, created_at);
CREATE INDEX idx_scribe_usage_events_external_job ON scribe_usage_events (provider, external_job_id)
    WHERE external_job_id IS NOT NULL;
