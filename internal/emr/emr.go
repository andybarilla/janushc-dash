package emr

import "context"

type Order struct {
	ID            string `json:"id"`
	PatientID     string `json:"patient_id"`
	PatientName   string `json:"patient_name"`
	ProcedureName string `json:"procedure_name"`
	Dosage        string `json:"dosage,omitempty"`
	StaffName     string `json:"staff_name,omitempty"`
	OrderDate     string `json:"order_date"`
	Status        string `json:"status"`
	EncounterID   string `json:"encounter_id,omitempty"`
	OrderType     string `json:"order_type,omitempty"`
	DepartmentID  string `json:"department_id,omitempty"`
}

type Department struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Patient struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Diagnosis struct {
	Code        string `json:"code"`
	Description string `json:"description"`
}

type Encounter struct {
	ID           string `json:"id"`
	PatientID    string `json:"patient_id"`
	DepartmentID string `json:"department_id"`
	Date         string `json:"date"`
}

type EMR interface {
	ListPatientOrders(ctx context.Context, practiceID, patientID, departmentID string, orderTypes []string) ([]Order, error)
	ListDepartments(ctx context.Context, practiceID string) ([]Department, error)
	ListDepartmentPatients(ctx context.Context, practiceID, departmentID string) ([]Patient, error)
	GetPatientName(ctx context.Context, practiceID, patientID string) (string, error)
	ApproveOrders(ctx context.Context, practiceID string, orderIDs []string) ([]string, error)
	GetActiveDiagnoses(ctx context.Context, practiceID, patientID string) ([]Diagnosis, error)
	ListTodayEncounters(ctx context.Context, practiceID, departmentID string) ([]Encounter, error)
	WriteEncounterHPI(ctx context.Context, practiceID, encounterID, hpiText string) error
	WriteEncounterAssessmentPlan(ctx context.Context, practiceID, encounterID, apText string) error
	WriteEncounterPhysicalExam(ctx context.Context, practiceID, encounterID, peText string) error
}
