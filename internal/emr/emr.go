package emr

import "context"

// Order represents a pending procedure order from any EMR.
type Order struct {
	ID            string            `json:"id"`
	PatientID     string            `json:"patient_id"`
	PatientName   string            `json:"patient_name"`
	ProcedureName string            `json:"procedure_name"`
	Dosage        string            `json:"dosage,omitempty"`
	StaffName     string            `json:"staff_name,omitempty"`
	OrderDate     string            `json:"order_date"`
	Status        string            `json:"status"`
	Metadata      map[string]string `json:"metadata,omitempty"`
}

// PatientContext is the relevant chart data for flagging decisions.
type PatientContext struct {
	PatientID       string   `json:"patient_id"`
	IsNewPatient    bool     `json:"is_new_patient"`
	LastLabDate     string   `json:"last_lab_date,omitempty"`
	PreviousDosages []string `json:"previous_dosages,omitempty"`
}

// EMR is the abstraction layer for interacting with any EMR system.
type EMR interface {
	ListPendingOrders(ctx context.Context, practiceID string, procedureTypes []string) ([]Order, error)
	ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error)
	GetPatientContext(ctx context.Context, practiceID, patientID string) (*PatientContext, error)
}
