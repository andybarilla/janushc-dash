import type { LucideIcon } from "lucide-react";

export type StatusId =
  | "queued"
  | "transcribing"
  | "extracting"
  | "ready"
  | "sent"
  | "failed";

export type StatusTone =
  | "neutral"
  | "progress"
  | "attention"
  | "success"
  | "error"
  | "warning";

export interface StatusDef {
  id: StatusId;
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
}

export type SectionKey = "hpi" | "plan" | "exam" | "labs";

export type Approvals = Record<SectionKey, boolean>;

export type NoteTarget = SectionKey | "overall";

export type NoteCategoryId =
  | "missed_info"
  | "incorrect"
  | "hallucination"
  | "formatting"
  | "good"
  | "comment";

export interface FeedbackNote {
  id: string;
  author: string;
  authorInitials: string;
  at: string;
  section: NoteTarget;
  category: NoteCategoryId;
  body: string;
}

export interface NoteCategoryDef {
  id: NoteCategoryId;
  label: string;
  icon: LucideIcon;
}
