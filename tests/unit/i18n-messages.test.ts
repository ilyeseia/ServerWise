import { describe, expect, it } from "vitest";
import ar from "../../messages/ar.json";
import fr from "../../messages/fr.json";
import { defaultLocale, isLocale, localeDirection, locales } from "@/i18n/routing";

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
    const exempt = new Set(["Metadata.title", "Common.appName", "Header.switchToFrench"]);
    for (const [key, value] of Object.entries(arKeys)) {
      if (!exempt.has(key)) expect(value, key).toMatch(arabic);
    }
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
