import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type {
  DiagnosisLab,
  FeedbackNote,
  NoteCategoryId,
  NoteTarget,
  SectionContent,
  SectionKey,
} from "@/components/scribe/types";

export type SectionState = "pending" | "approved" | "stale";

export interface SectionStateData {
  state: SectionState;
  content: SectionContent;
  approved_by_name?: string;
  approved_at?: string;
  edited_at?: string;
}

export interface ScribeSession {
  id: string;
  patient_id: string;
  encounter_id: string;
  department_id: string;
  status: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
  sent_to_ehr_at?: string;
  rejected_at?: string;
  approved_count: number;
}

export interface ScribeSessionDetail extends ScribeSession {
  transcript?: string;
  ai_output?: {
    hpi: string;
    assessment_plan: string;
    physical_exam: string;
    diagnoses_labs: DiagnosisLab[];
  };
  sections: Record<SectionKey, SectionStateData>;
  audio_available: boolean;
  sent_to_ehr_at?: string;
  rejected_at?: string;
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

export function useEditSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      section,
      content,
    }: {
      sessionId: string;
      section: SectionKey;
      content: SectionContent;
    }) =>
      api.fetch<Record<string, never>>(
        `/api/scribe/sessions/${sessionId}/sections/${section}`,
        {
          method: "PUT",
          body: JSON.stringify({ content }),
        },
      ),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions", sessionId] });
    },
  });
}

export function useRejectSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) =>
      api.fetch<Record<string, never>>(
        `/api/scribe/sessions/${sessionId}/reject`,
        { method: "POST" },
      ),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["scribeSessions"] });
    },
  });
}

export function useApproveSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, section }: { sessionId: string; section: SectionKey }) =>
      api.fetch<Record<string, never>>(
        `/api/scribe/sessions/${sessionId}/sections/${section}/approve`,
        { method: "POST" },
      ),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["scribeSessions"] });
    },
  });
}

export function useSendToEHR() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) =>
      api.fetch<Record<string, never>>(
        `/api/scribe/sessions/${sessionId}/send`,
        { method: "POST" },
      ),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["scribeSessions"] });
    },
  });
}

export function useRevokeSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, section }: { sessionId: string; section: SectionKey }) =>
      api.fetch<Record<string, never>>(
        `/api/scribe/sessions/${sessionId}/sections/${section}/revoke`,
        { method: "POST" },
      ),
    onSuccess: (_data, { sessionId }) => {
      queryClient.invalidateQueries({ queryKey: ["scribeSessions", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["scribeSessions"] });
    },
  });
}

interface CreateFeedbackRequest {
  sessionId: string;
  section: NoteTarget;
  category: NoteCategoryId;
  body: string;
}

export function useSessionFeedback(sessionId: string) {
  return useQuery({
    queryKey: ["scribeSessions", sessionId, "feedback"],
    queryFn: () =>
      api.fetch<FeedbackNote[]>(`/api/scribe/sessions/${sessionId}/feedback`),
    enabled: !!sessionId,
  });
}

export function useAddFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, section, category, body }: CreateFeedbackRequest) =>
      api.fetch<FeedbackNote>(`/api/scribe/sessions/${sessionId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ section, category, body }),
      }),
    onMutate: async (vars) => {
      const key = ["scribeSessions", vars.sessionId, "feedback"];
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<FeedbackNote[]>(key) ?? [];
      const optimistic: FeedbackNote = {
        id: `tmp_${Date.now()}`,
        author: "You",
        authorInitials: "YO",
        at: new Date().toISOString(),
        section: vars.section,
        category: vars.category,
        body: vars.body,
      };
      queryClient.setQueryData<FeedbackNote[]>(key, [...prev, optimistic]);
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) queryClient.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["scribeSessions", vars.sessionId, "feedback"],
      });
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
