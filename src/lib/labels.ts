import type { segment } from "@/db/schema";
import type { ProblemStatus } from "@/domain/problems";
import type { Judged } from "@/domain/ranking";

export type Segment = (typeof segment.enumValues)[number];

export const SEGMENT_LABELS: Record<Segment, string> = {
  smb: "SMB",
  mid_market: "Mid-market",
  enterprise: "Enterprise",
};

export const STATUS_LABELS: Record<ProblemStatus, string> = {
  open: "Open",
  under_review: "Under review",
  planned: "Planned",
  declined: "Declined",
  shipped: "Shipped",
};

export const JUDGED_LABELS: Record<Judged, string> = {
  strategicFit: "Strategic fit",
  urgency: "Urgency",
  effort: "Effort (rough guess)",
};
