CREATE TABLE protocols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    procedure_name TEXT NOT NULL,
    standard_dosage TEXT,
    max_lab_age_days INT NOT NULL DEFAULT 90,
    requires_established_patient BOOLEAN NOT NULL DEFAULT true,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE approval_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    approved_by UUID NOT NULL REFERENCES users(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    order_count INT NOT NULL,
    flagged_count INT NOT NULL DEFAULT 0
);

CREATE TABLE approval_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id UUID REFERENCES approval_batches(id),
    tenant_id UUID NOT NULL,
    emr_order_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    patient_name TEXT NOT NULL,
    procedure_name TEXT NOT NULL,
    dosage TEXT,
    staff_name TEXT,
    order_date DATE NOT NULL,
    flagged BOOLEAN NOT NULL DEFAULT false,
    flag_reasons JSONB,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'needs_review', 'skipped')),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, emr_order_id)
);

CREATE INDEX idx_approval_items_tenant_status ON approval_items (tenant_id, status);
CREATE INDEX idx_approval_items_batch ON approval_items (batch_id);
