import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { defaultLocale, formatLocaleTag, isLocale, localeDirection, locales } from "@/i18n/routing";
import { LEAD_STATUSES } from "@/modules/crm/lead-status";
import { COMMUNICATION_CHANNELS, LEAD_SOURCES } from "@/modules/crm/schemas";
import { QUESTIONNAIRES } from "@/modules/questionnaire/definition";
import { AUDIT_ACTIONS, auditMessageKey } from "@/server/audit";

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object") {
      Object.assign(acc, flatten(value as Record<string, unknown>, path));
    } else {
      acc[path] = String(value);
    }
    return acc;
  }, {});
}

describe("translations", () => {
  const arKeys = flatten(ar);
  const frKeys = flatten(fr);

  it("have identical key sets in Arabic and French", () => {
    expect(Object.keys(frKeys).sort()).toEqual(Object.keys(arKeys).sort());
  });

  it("have no empty values", () => {
    for (const [key, value] of [...Object.entries(arKeys), ...Object.entries(frKeys)]) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("contain Arabic script in the Arabic copy (no French leaked in)", () => {
    const arabic = /[؀-ۿ]/;
    const exempt = new Set([
      "Metadata.title",
      "Common.appName",
      "Common.none",
      "Header.switchToFrench",
      // Symbols and product / technology names that are written the same in Arabic:
      "Crm.common.none",
      "Requirements.o.redundancy.raid5",
      "Requirements.o.redundancy.raid6",
      "Requirements.o.remoteMethod.tailscale",
      "Requirements.o.remoteMethod.wireguard",
      "Requirements.o.storageMedia.ssd",
      "Requirements.o.storageMedia.hdd",
    ]);
    for (const [key, value] of Object.entries(arKeys)) {
      if (!exempt.has(key)) expect(value, key).toMatch(arabic);
    }
  });
});

describe("requirements questionnaire labels", () => {
  for (const [name, messages] of [
    ["ar", flatten(ar)],
    ["fr", flatten(fr)],
  ] as const) {
    it(`${name}: every section, question and option of every version has a label`, () => {
      for (const definition of Object.values(QUESTIONNAIRES)) {
        for (const section of definition.sections) {
          expect(
            messages[`Requirements.sections.${section.id}`],
            `section ${section.id}`,
          ).toBeTruthy();
          for (const q of section.questions) {
            expect(messages[`Requirements.q.${q.id}`], `question ${q.id}`).toBeTruthy();
            if (q.kind === "single" || q.kind === "multi") {
              for (const option of q.options) {
                expect(
                  messages[`Requirements.o.${q.id}.${option}`],
                  `option ${q.id}.${option}`,
                ).toBeTruthy();
              }
            }
          }
        }
      }
    });

    it(`${name}: every validation code and CRM error code has a message`, () => {
      for (const code of [
        "required",
        "invalid_type",
        "invalid_option",
        "too_small",
        "too_large",
        "too_long",
        "not_integer",
        "below_minimum_question",
      ]) {
        expect(messages[`Requirements.errors.${code}`], code).toBeTruthy();
      }
      for (const code of [
        "NOT_FOUND",
        "CUSTOMER_ARCHIVED",
        "HAS_OPEN_LEADS",
        "INVALID_TRANSITION",
        "LOST_REASON_REQUIRED",
        "INVALID_OWNER",
        "INVALID_ASSIGNEE",
        "LEAD_CLOSED",
        "LEAD_CUSTOMER_MISMATCH",
        "FUTURE_DATE",
        "UNKNOWN_QUESTIONNAIRE_VERSION",
        "VALIDATION",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "UNKNOWN",
      ]) {
        expect(messages[`Crm.errors.${code}`], code).toBeTruthy();
      }
    });

    it(`${name}: every lead status, source, channel and customer type is translated`, () => {
      const groups: Record<string, readonly string[]> = {
        "Crm.leadStatus": LEAD_STATUSES,
        "Crm.leadSource": LEAD_SOURCES,
        "Crm.channel": COMMUNICATION_CHANNELS,
        "Crm.type": ["individual", "business"],
        "Crm.customerStatus": ["prospect", "active", "archived"],
        "Crm.direction": ["inbound", "outbound"],
      };
      for (const [prefix, values] of Object.entries(groups)) {
        for (const v of values) expect(messages[`${prefix}.${v}`], `${prefix}.${v}`).toBeTruthy();
      }
    });
  }
});

describe("audit labels", () => {
  it("every audit action has a label in both languages", () => {
    for (const messages of [flatten(ar), flatten(fr)]) {
      for (const action of AUDIT_ACTIONS) {
        expect(messages[`Audit.actions.${auditMessageKey(action)}`], action).toBeTruthy();
      }
    }
  });

  it("message keys never contain dots (next-intl would treat them as nesting)", () => {
    const keys = (obj: Record<string, unknown>): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        v !== null && typeof v === "object" ? [k, ...keys(v as Record<string, unknown>)] : [k],
      );
    for (const k of [...keys(ar), ...keys(fr)]) expect(k).not.toContain(".");
  });
});

describe("number and date formatting", () => {
  const arabicIndic = /[٠-٩۰-۹]/;

  it("uses Western digits in Arabic, as Algeria does", () => {
    const date = new Date(Date.UTC(2026, 9, 20, 14, 5));
    const number = new Intl.NumberFormat(formatLocaleTag.ar).format(1234567.5);
    const stamp = new Intl.DateTimeFormat(formatLocaleTag.ar, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);

    expect(number).toMatch(/[0-9]/);
    expect(number).not.toMatch(arabicIndic);
    expect(stamp).toMatch(/2026/);
    expect(stamp).not.toMatch(arabicIndic);
  });

  it("keeps French conventions in French", () => {
    expect(new Intl.NumberFormat(formatLocaleTag.fr).format(1234567.5)).toMatch(/1.234.567,5/);
  });
});

describe("routing", () => {
  it("uses Arabic as the default locale with RTL direction", () => {
    expect(defaultLocale).toBe("ar");
    expect(localeDirection.ar).toBe("rtl");
    expect(localeDirection.fr).toBe("ltr");
  });

  it("recognises only supported locales", () => {
    expect(locales.every(isLocale)).toBe(true);
    expect(isLocale("en")).toBe(false);
  });
});
