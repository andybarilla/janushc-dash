-- migrations/006_scribe_sessions.up.sql
CREATE TABLE scribe_sessions (
    id UUID PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(6)))),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    patient_id TEXT NOT NULL,
    encounter_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('recording', 'processing', 'complete', 'error')) DEFAULT 'recording',
    transcript TEXT,
    ai_output JSONB,
    error_message TEXT,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scribe_sessions_tenant_created ON scribe_sessions (tenant_id, created_at DESC);
CREATE INDEX idx_scribe_sessions_tenant_patient ON scribe_sessions (tenant_id, patient_id);
CREATE INDEX idx_scribe_sessions_tenant_status ON scribe_sessions (tenant_id, status);
