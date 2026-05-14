import {
  AlignLeft,
  CircleDot,
  CircleHelp,
  CircleX,
  Clock,
  Flame,
  Mic,
  Sparkles,
  ThumbsUp,
  MessageSquare,
  Check,
  TriangleAlert,
} from "lucide-react";
import type {
  NoteCategoryDef,
  StatusDef,
  StatusId,
} from "./types";
import type { ScribeSession, ScribeSessionDetail } from "@/lib/scribe-queries";

export const STATUS: Record<StatusId, StatusDef> = {
  queued: { id: "queued", label: "Queued", tone: "neutral", icon: Clock },
  transcribing: {
    id: "transcribing",
    label: "Transcribing",
    tone: "progress",
    icon: Mic,
  },
  extracting: {
    id: "extracting",
    label: "Extracting",
    tone: "progress",
    icon: Sparkles,
  },
  ready: {
    id: "ready",
    label: "Ready for review",
    tone: "attention",
    icon: CircleDot,
  },
  sent: { id: "sent", label: "Sent to EHR", tone: "success", icon: Check },
  failed: {
    id: "failed",
    label: "Failed",
    tone: "error",
    icon: TriangleAlert,
  },
};

// Backend currently has 4 status values; map them to the design's 7 here.
// The "sent" state is driven by client-side approval — a complete session
// with all sections approved is treated as sent.
export function deriveStatusId(
  session: { status: string; transcript?: string },
  approvedCount: number,
): StatusId {
  switch (session.status) {
    case "recording":
      return "queued";
    case "processing":
      return session.transcript && session.transcript.length > 0
        ? "extracting"
        : "transcribing";
    case "complete":
      return approvedCount === 4 ? "sent" : "ready";
    case "error":
      return "failed";
    default:
      return "queued";
  }
}

export function isInPipeline(id: StatusId) {
  return id === "queued" || id === "transcribing" || id === "extracting";
}

export const NOTE_CATEGORIES: NoteCategoryDef[] = [
  { id: "missed_info", label: "Missed info", icon: CircleHelp },
  { id: "incorrect", label: "Incorrect extraction", icon: CircleX },
  { id: "hallucination", label: "Hallucination", icon: Flame },
  { id: "formatting", label: "Formatting", icon: AlignLeft },
  { id: "good", label: "Good output", icon: ThumbsUp },
  { id: "comment", label: "General comment", icon: MessageSquare },
];

export function wordCount(text: string | undefined): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// Sessions only include the section-level data once the AI output is present.
export function hasSections(session: ScribeSessionDetail | ScribeSession) {
  return "ai_output" in session && !!session.ai_output;
}
