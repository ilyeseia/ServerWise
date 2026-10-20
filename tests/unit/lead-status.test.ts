import { describe, expect, it } from "vitest";
import {
  LEAD_STATUSES,
  allowedNextStatuses,
  canTransition,
  isClosed,
  isOpen,
  transitionEffect,
  type LeadStatus,
} from "@/modules/crm/lead-status";

/** The intended pipeline, written out by hand (not derived from the implementation). */
const ALLOWED: Record<LeadStatus, LeadStatus[]> = {
  new: ["contacted", "qualified", "lost"],
  contacted: ["qualified", "proposal", "lost"],
  qualified: ["contacted", "proposal", "lost"],
  proposal: ["qualified", "won", "lost"],
  won: [],
  lost: ["contacted"],
};

describe("lead status state machine", () => {
  for (const from of LEAD_STATUSES) {
    for (const to of LEAD_STATUSES) {
      const expected = ALLOWED[from].includes(to);
      it(`${from} -> ${to} is ${expected ? "allowed" : "refused"}`, () => {
        expect(canTransition(from, to)).toBe(expected);
      });
    }
  }

  it("lists exactly the allowed next statuses", () => {
    for (const from of LEAD_STATUSES) {
      expect([...allowedNextStatuses(from)].sort()).toEqual([...ALLOWED[from]].sort());
    }
  });

  it("never lets a lead skip straight to won", () => {
    for (const from of LEAD_STATUSES.filter((s) => s !== "proposal")) {
      expect(canTransition(from, "won")).toBe(false);
    }
  });

  it("treats won as terminal", () => {
    expect(allowedNextStatuses("won")).toHaveLength(0);
    expect(isClosed("won")).toBe(true);
  });

  it("only reopens a lost lead to contacted", () => {
    expect(allowedNextStatuses("lost")).toEqual(["contacted"]);
  });

  it("classifies open and closed statuses", () => {
    expect(LEAD_STATUSES.filter(isClosed).sort()).toEqual(["lost", "won"]);
    expect(LEAD_STATUSES.filter(isOpen).sort()).toEqual([
      "contacted",
      "new",
      "proposal",
      "qualified",
    ]);
  });

  it("describes the side effects of each target status", () => {
    expect(transitionEffect("won")).toEqual({
      closedAt: "now",
      customerStatus: "active",
      requiresLostReason: false,
    });
    expect(transitionEffect("lost")).toEqual({
      closedAt: "now",
      customerStatus: null,
      requiresLostReason: true,
    });
    for (const open of ["new", "contacted", "qualified", "proposal"] as const) {
      expect(transitionEffect(open)).toEqual({
        closedAt: null,
        customerStatus: null,
        requiresLostReason: false,
      });
    }
  });
});
