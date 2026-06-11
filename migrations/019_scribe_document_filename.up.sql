-- migrations/019_ocr_documents.up.sql
CREATE TABLE ocr_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    user_id UUID NOT NULL REFERENCES users(id),
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('uploaded', 'extracting', 'extracted', 'error')) DEFAULT 'uploaded',
    error_message TEXT,
    extracted_text TEXT,
    scribe_session_id UUID REFERENCES scribe_sessions(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    extracted_at TIMESTAMPTZ
);

CREATE INDEX idx_ocr_documents_tenant_created ON ocr_documents (tenant_id, created_at DESC);
CREATE INDEX idx_ocr_documents_tenant_status ON ocr_documents (tenant_id, status);

ALTER TABLE scribe_sessions ADD COLUMN document_id UUID REFERENCES ocr_documents(id);
