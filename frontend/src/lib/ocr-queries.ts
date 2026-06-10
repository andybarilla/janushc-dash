import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export type DocumentStatus = "uploaded" | "extracting" | "extracted" | "error";

export interface OcrDocument {
  id: string;
  original_filename: string;
  content_type: string;
  status: DocumentStatus;
  error_message?: string;
  extracted_text?: string;
  scribe_session_id?: string;
  created_at: string;
}

export interface ProcessDocumentInput {
  id: string;
  patient_id: string;
  appointment_id: string;
  department_id: string;
}

export interface ProcessDocumentResult {
  scribe_session_id: string;
}

export const documentsQueryKey = ["ocrDocuments"] as const;

function anyExtracting(docs: OcrDocument[] | undefined): boolean {
  return !!docs?.some((d) => d.status === "extracting" || d.status === "uploaded");
}

export function useDocuments() {
  return useQuery({
    queryKey: documentsQueryKey,
    queryFn: () => api.fetch<OcrDocument[]>("/api/ocr/documents"),
    refetchInterval: (query) => (anyExtracting(query.state.data) ? 3000 : false),
  });
}

export function useDocument(id: string | null) {
  return useQuery({
    queryKey: ["ocrDocument", id],
    queryFn: () => api.fetch<OcrDocument>(`/api/ocr/documents/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "extracting" || status === "uploaded" ? 3000 : false;
    },
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("document", file);
      return api.upload<OcrDocument>("/api/ocr/documents", form);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.fetch<void>(`/api/ocr/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}

export function useProcessDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ProcessDocumentInput) =>
      api.fetch<ProcessDocumentResult>(`/api/ocr/documents/${id}/process`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: documentsQueryKey });
    },
  });
}
