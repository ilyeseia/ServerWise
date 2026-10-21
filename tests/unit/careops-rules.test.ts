import { describe, expect, it } from "vitest";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  addMonthsUtc,
  allowedNextTicketStatuses,
  canTransitionTicket,
  contractState,
  isTicketClosed,
  isTicketOpen,
  isoDay,
  nextDueDate,
  priorityRank,
  reminderKey,
  renewalState,
  scheduleState,
  startOfDayUtc,
  ticketBlockers,
} from "@/modules/careops/rules";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("ticket state machine", () => {
  it("allows exactly the documented moves", () => {
    const table = Object.fromEntries(
      TICKET_STATUSES.map((s) => [s, [...allowedNextTicketStatuses(s)].sort()]),
    );
    expect(table).toEqual({
      open: ["closed", "in_progress", "resolved", "waiting_customer"],
      in_progress: ["open", "resolved", "waiting_customer"],
      waiting_customer: ["closed", "in_progress", "resolved"],
      resolved: ["closed", "in_progress"],
      closed: [],
    });
  });

  it("never moves to itself, and closed is final", () => {
    for (const s of TICKET_STATUSES) expect(canTransitionTicket(s, s)).toBe(false);
    for (const to of TICKET_STATUSES) expect(canTransitionTicket("closed", to)).toBe(false);
    expect(isTicketClosed("closed")).toBe(true);
  });

  it("a resolved ticket can be reopened but not sent back to open or waiting", () => {
    expect(canTransitionTicket("resolved", "in_progress")).toBe(true);
    expect(canTransitionTicket("resolved", "open")).toBe(false);
    expect(canTransitionTicket("resolved", "waiting_customer")).toBe(false);
  });

  it("needs a written resolution to resolve", () => {
    expect(ticketBlockers("resolved", { resolution: null })).toEqual(["RESOLUTION_REQUIRED"]);
    expect(ticketBlockers("resolved", { resolution: "   " })).toEqual(["RESOLUTION_REQUIRED"]);
    expect(ticketBlockers("resolved", { resolution: "Replaced the PSU" })).toEqual([]);
    expect(ticketBlockers("closed", { resolution: null })).toEqual([]);
    expect(ticketBlockers("in_progress", { resolution: null })).toEqual([]);
  });

  it("tells open work from finished work and ranks priorities", () => {
    expect(TICKET_STATUSES.filter(isTicketOpen)).toEqual([
      "open",
      "in_progress",
      "waiting_customer",
    ]);
    const sorted = [...TICKET_PRIORITIES].sort((a, b) => priorityRank(a) - priorityRank(b));
    expect(sorted).toEqual(["urgent", "high", "normal", "low"]);
  });
});

describe("calendar arithmetic", () => {
  it("adds months and clamps to the end of shorter months", () => {
    expect(isoDay(addMonthsUtc(d("2026-01-15"), 1))).toBe("2026-02-15");
    expect(isoDay(addMonthsUtc(d("2026-01-31"), 1))).toBe("2026-02-28");
    expect(isoDay(addMonthsUtc(d("2028-01-31"), 1))).toBe("2028-02-29"); // leap year
    expect(isoDay(addMonthsUtc(d("2026-03-31"), 1))).toBe("2026-04-30");
    expect(isoDay(addMonthsUtc(d("2026-11-30"), 3))).toBe("2027-02-28");
    expect(isoDay(addMonthsUtc(d("2026-06-10"), 12))).toBe("2027-06-10");
    expect(isoDay(addMonthsUtc(d("2026-12-31"), 2))).toBe("2027-02-28");
  });

  it("works on the calendar day whatever the time of day", () => {
    expect(startOfDayUtc(new Date("2026-05-05T23:59:59.999Z")).toISOString()).toBe(
      "2026-05-05T00:00:00.000Z",
    );
  });
});

describe("next maintenance date", () => {
  const base = { intervalMonths: 3, contractEndsAt: d("2027-12-31") };

  it("is the anchor until a visit has been done", () => {
    expect(isoDay(nextDueDate({ ...base, anchorDate: d("2026-11-01"), lastDoneAt: null })!)).toBe(
      "2026-11-01",
    );
  });

  it("is one interval after the last visit, whenever it happened", () => {
    expect(
      isoDay(nextDueDate({ ...base, anchorDate: d("2026-11-01"), lastDoneAt: d("2026-11-20") })!),
    ).toBe("2027-02-20");
    // A late visit pushes the next one later (interval counted from the real visit).
    expect(
      isoDay(nextDueDate({ ...base, anchorDate: d("2026-11-01"), lastDoneAt: d("2027-01-15") })!),
    ).toBe("2027-04-15");
  });

  it("falls to null after the contract ends", () => {
    expect(
      nextDueDate({
        anchorDate: d("2026-11-01"),
        intervalMonths: 6,
        lastDoneAt: d("2027-09-01"),
        contractEndsAt: d("2027-12-31"),
      }),
    ).toBeNull();
    // Exactly on the last day is still allowed.
    expect(
      isoDay(
        nextDueDate({
          anchorDate: d("2026-11-01"),
          intervalMonths: 3,
          lastDoneAt: d("2027-09-30"),
          contractEndsAt: d("2027-12-30"),
        })!,
      ),
    ).toBe("2027-12-30");
  });

  it("has no end when the contract has none", () => {
    expect(
      nextDueDate({
        anchorDate: d("2026-01-01"),
        intervalMonths: 1,
        lastDoneAt: d("2030-01-01"),
        contractEndsAt: null,
      }),
    ).not.toBeNull();
  });
});

describe("schedule state", () => {
  const now = new Date("2026-10-21T15:30:00.000Z");

  it("classifies a due date against today", () => {
    expect(scheduleState(d("2026-10-20"), now)).toBe("overdue");
    expect(scheduleState(d("2026-10-21"), now)).toBe("due_soon"); // today is not overdue
    expect(scheduleState(d("2026-10-28"), now)).toBe("due_soon");
    expect(scheduleState(d("2026-10-29"), now)).toBe("upcoming");
    expect(scheduleState(null, now)).toBe("finished");
  });

  it("honours a custom lead time", () => {
    expect(scheduleState(d("2026-11-10"), now, 30)).toBe("due_soon");
    expect(scheduleState(d("2026-11-10"), now, 7)).toBe("upcoming");
  });

  it("builds a stable reminder key per schedule and day", () => {
    expect(reminderKey("abc", new Date("2026-11-01T13:00:00.000Z"))).toBe("abc:2026-11-01");
    expect(reminderKey("abc", d("2026-11-01"))).toBe(reminderKey("abc", d("2026-11-01")));
    expect(reminderKey("abc", d("2026-11-01"))).not.toBe(reminderKey("abd", d("2026-11-01")));
  });
});

describe("contract and renewal states", () => {
  const now = new Date("2026-10-21T10:00:00.000Z");
  const contract = (startsAt: string, endsAt: string, cancelledAt: Date | null = null) => ({
    startsAt: d(startsAt),
    endsAt: d(endsAt),
    cancelledAt,
  });

  it("derives the contract state from its dates", () => {
    expect(contractState(contract("2026-11-01", "2027-10-31"), now)).toBe("scheduled");
    expect(contractState(contract("2026-01-01", "2026-12-31"), now)).toBe("active");
    expect(contractState(contract("2026-01-01", "2026-10-21"), now)).toBe("active"); // last day
    expect(contractState(contract("2025-01-01", "2026-10-20"), now)).toBe("expired");
    expect(contractState(contract("2026-01-01", "2026-12-31", new Date()), now)).toBe("cancelled");
  });

  it("warns before a warranty or subscription ends", () => {
    expect(renewalState(null, now)).toBe("unknown");
    expect(renewalState(d("2026-10-20"), now)).toBe("expired");
    expect(renewalState(d("2026-10-21"), now)).toBe("expiring");
    expect(renewalState(d("2026-11-20"), now)).toBe("expiring");
    expect(renewalState(d("2026-11-21"), now)).toBe("ok");
    expect(renewalState(d("2026-11-21"), now, 60)).toBe("expiring");
  });
});
