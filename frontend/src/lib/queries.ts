import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { api } from "./api";

export type UserRole = "admin" | "physician" | "staff";

interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  created_at: string;
}

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
}

export function useCurrentUser(enabled = true) {
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: () => api.fetch<UserProfile>("/api/auth/me"),
    enabled,
  });
}

export function useManagedUsers(): UseQueryResult<ManagedUser[], Error> {
  return useQuery({
    queryKey: ["managedUsers"],
    queryFn: () => api.fetch<ManagedUser[]>("/api/users"),
  });
}

export function useCreateUser(): UseMutationResult<ManagedUser, Error, CreateUserInput> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateUserInput): Promise<ManagedUser> =>
      api.fetch<ManagedUser>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          email: input.email.trim().toLowerCase(),
          name: input.name.trim(),
          role: input.role,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["managedUsers"] });
    },
  });
}

export interface ApprovalItem {
  id: string;
  patient_name: string;
  procedure_name: string;
  dosage?: string;
  staff_name?: string;
  order_date: string;
  flagged: boolean;
  flag_reasons?: string[];
  status: string;
}

export function useApprovals() {
  return useQuery({
    queryKey: ["approvals"],
    queryFn: () => api.fetch<ApprovalItem[]>("/api/approvals"),
  });
}

interface SyncResponse {
  synced_count: number;
}

export function useSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.fetch<SyncResponse>("/api/approvals/sync", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export function useBatchApprove() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemIds: string[]) =>
      api.fetch("/api/approvals/batch-approve", {
        method: "POST",
        body: JSON.stringify({ item_ids: itemIds }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}
