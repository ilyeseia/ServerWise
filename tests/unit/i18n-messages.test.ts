import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { defaultLocale, isLocale, localeDirection, locales } from "@/i18n/routing";
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
    ]);
    for (const [key, value] of Object.entries(arKeys)) {
      if (!exempt.has(key)) expect(value, key).toMatch(arabic);
    }
  });
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
