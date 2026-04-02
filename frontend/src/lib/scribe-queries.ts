import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface ScribeSession {
  id: string;
  patient_id: string;
  encounter_id: string;
  department_id: string;
  status: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

export interface ScribeSessionDetail extends ScribeSession {
  transcript?: string;
  ai_output?: {
    hpi: string;
    assessment_plan: string;
    physical_exam: string;
    diagnoses_labs: { diagnosis: string; lab: string }[];
  };
}

interface CreateSessionRequest {
  patient_id: string;
  encounter_id: string;
  department_id: string;
}

export function useScribeSessions() {
  return useQuery({
    queryKey: ["scribeSessions"],
    queryFn: () => api.fetch<ScribeSession[]>("/api/scribe/sessions"),
  });
}

export function useScribeSession(id: string) {
  return useQuery({
    queryKey: ["scribeSessions", id],
    queryFn: () => api.fetch<ScribeSessionDetail>(`/api/scribe/sessions/${id}`),
    enabled: !!id,
  });
}

export function useCreateScribeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateSessionRequest) =>
      api.fetch<ScribeSession>("/api/scribe/sessions", {
        method: "POST",
        body: JSON.stringify(req),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions"] });
    },
  });
}

export function useUploadScribeAudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => {
      const formData = new FormData();
      formData.append("audio", file);
      return api.upload<ScribeSession>(
        `/api/scribe/sessions/${id}/upload`,
        formData
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions"] });
    },
  });
}
