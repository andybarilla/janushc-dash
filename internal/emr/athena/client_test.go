package athena

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientGetToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	token, err := client.getToken()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "test-token" {
		t.Errorf("expected test-token, got %s", token)
	}
}

func TestListPatientOrders(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		if r.URL.Path == "/v1/195900/patients/1/documents/order" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"orders":[
				{"orderid":101,"patientid":1,"documentdescription":"Testosterone Injection","createddate":"03/15/2026","status":"REVIEW","ordertype":"PROCEDURE","encounterid":"enc1","departmentid":"dept1"},
				{"orderid":102,"patientid":1,"documentdescription":"CBC Panel","createddate":"03/15/2026","status":"REVIEW","ordertype":"LAB","encounterid":"enc2","departmentid":"dept1"}
			]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	orders, err := client.ListPatientOrders(context.Background(), "195900", "1", "dept1", []string{"PROCEDURE"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(orders) != 1 {
		t.Fatalf("expected 1 order after filtering, got %d", len(orders))
	}
	if orders[0].ID != "101" {
		t.Errorf("expected order ID 101, got %s", orders[0].ID)
	}
	if orders[0].PatientID != "1" {
		t.Errorf("expected patient ID 1, got %s", orders[0].PatientID)
	}
	if orders[0].ProcedureName != "Testosterone Injection" {
		t.Errorf("expected Testosterone Injection, got %s", orders[0].ProcedureName)
	}
}

func TestGetPatientName(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		if r.URL.Path == "/v1/195900/patients/1" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`[{"firstname":"Jane","lastname":"Doe"}]`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	name, err := client.GetPatientName(context.Background(), "195900", "1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if name != "Jane Doe" {
		t.Errorf("expected 'Jane Doe', got '%s'", name)
	}
}

func TestListDepartments(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		if r.URL.Path == "/v1/195900/departments" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"departments":[
				{"departmentid":"1","name":"Primary Care","clinicals":"ON"},
				{"departmentid":"2","name":"Billing","clinicals":"OFF"},
				{"departmentid":"3","name":"Urgent Care","clinicals":"ON"}
			]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	depts, err := client.ListDepartments(context.Background(), "195900")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(depts) != 2 {
		t.Fatalf("expected 2 clinical departments, got %d", len(depts))
	}
	if depts[0].ID != "1" || depts[1].ID != "3" {
		t.Errorf("unexpected department IDs: %v", depts)
	}
}
