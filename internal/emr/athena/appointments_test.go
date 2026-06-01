package athena

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func tokenAwareServer(handler http.HandlerFunc) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth2/v1/token" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"access_token":"test-token","expires_in":3600}`))
			return
		}
		handler(w, r)
	}))
}

func TestListTodayAppointments(t *testing.T) {
	server := tokenAwareServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/195900/appointments/booked" {
			if got := r.URL.Query().Get("departmentid"); got != "dept1" {
				t.Errorf("departmentid = %q, want dept1", got)
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"appointments":[
				{"appointmentid":"A1","patientid":"P1","patientfirstname":"Jane","patientlastname":"Doe","starttime":"09:30","appointmentstatus":"2 - Checked In","departmentid":"dept1"},
				{"appointmentid":"A2","patientid":"P2","patientfirstname":"John","patientlastname":"Smith","starttime":"10:00","appointmentstatus":"f - Future","departmentid":"dept1"}
			]}`))
			return
		}
		http.NotFound(w, r)
	})
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	appts, err := client.ListTodayAppointments(context.Background(), "195900", "dept1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(appts) != 2 {
		t.Fatalf("len = %d, want 2", len(appts))
	}
	if appts[0].AppointmentID != "A1" || appts[0].PatientID != "P1" {
		t.Errorf("appt[0] ids = %q/%q", appts[0].AppointmentID, appts[0].PatientID)
	}
	if appts[0].PatientName != "Jane Doe" {
		t.Errorf("appt[0] name = %q, want Jane Doe", appts[0].PatientName)
	}
	if appts[1].Time != "10:00" {
		t.Errorf("appt[1] time = %q, want 10:00", appts[1].Time)
	}
}

func TestResolveEncounterID(t *testing.T) {
	server := tokenAwareServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/195900/appointments/A1" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"appointments":[{"appointmentid":"A1","encounterid":"E99"}]}`))
			return
		}
		http.NotFound(w, r)
	})
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	enc, err := client.ResolveEncounterID(context.Background(), "195900", "A1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if enc != "E99" {
		t.Errorf("encounter = %q, want E99", enc)
	}
}

func TestResolveEncounterIDNotCheckedIn(t *testing.T) {
	server := tokenAwareServer(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/195900/appointments/A2" {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"appointments":[{"appointmentid":"A2"}]}`))
			return
		}
		http.NotFound(w, r)
	})
	defer server.Close()

	client := NewClient(server.URL, "client-id", "client-secret")
	enc, err := client.ResolveEncounterID(context.Background(), "195900", "A2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if enc != "" {
		t.Errorf("encounter = %q, want empty", enc)
	}
}
