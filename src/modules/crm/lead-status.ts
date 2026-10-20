/**
 * Lead pipeline as an explicit state machine. The service refuses any transition that is not
 * listed here, so a lead cannot jump from "new" straight to "won".
 *
 *   new ─▶ contacted ─▶ qualified ─▶ proposal ─▶ won
 *    │ ╲       ▲ ╲          │ ▲          │
 *    │  ╲──────┘  ╲─────────┘ └──────────┘ (one step back is allowed)
 *    ╰────────────── any open stage ─▶ lost ─▶ contacted (reopen)
 */

export const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "proposal", "lost"],
  qualified: ["contacted", "proposal", "lost"],
  proposal: ["qualified", "won", "lost"],
  won: [],
  lost: ["contacted"],
};

export function allowedNextStatuses(from: LeadStatus): readonly LeadStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: LeadStatus, to: LeadStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Won and lost close the lead; every other status is open work. */
export function isClosed(status: LeadStatus): boolean {
  return status === "won" || status === "lost";
}

export function isOpen(status: LeadStatus): boolean {
  return !isClosed(status);
}

export interface TransitionEffect {
  /** Value for lead.closedAt: a date when closing, null when (re)opening or still open. */
  closedAt: "now" | null;
  /** Customer status to apply, if the transition changes it. */
  customerStatus: "active" | null;
  /** The transition needs a non-empty lost reason. */
  requiresLostReason: boolean;
}

export function transitionEffect(to: LeadStatus): TransitionEffect {
  return {
    closedAt: isClosed(to) ? "now" : null,
    customerStatus: to === "won" ? "active" : null,
    requiresLostReason: to === "lost",
  };
}
