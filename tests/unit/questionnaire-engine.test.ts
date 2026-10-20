import { describe, expect, it } from "vitest";
import {
  QUESTIONNAIRE_V1,
  QUESTIONNAIRES,
  LATEST_VERSION,
  getDefinition,
} from "@/modules/questionnaire/definition";
import {
  allQuestions,
  evaluate,
  normalizeAnswers,
  validateAnswers,
  visibleQuestions,
} from "@/modules/questionnaire/engine";
import type { Answers, QuestionnaireDefinition } from "@/modules/questionnaire/types";

const ids = (def: QuestionnaireDefinition, answers: Answers) =>
  visibleQuestions(def, answers).map((q) => q.id);

/** The minimum answers that satisfy every always-visible required question of v1. */
const BASE: Answers = {
  workloads: ["file_storage"],
  concurrentUsers: 4,
  budgetMaxDzd: 150000,
  cpuPriority: "balanced",
  storageTb: 0,
  alwaysOn: false,
  noiseLevel: "quiet",
  needsRemoteAccess: false,
  needsBackup: false,
  growth2y: "some",
};

describe("evaluate()", () => {
  const answers: Answers = { a: true, b: "x", c: ["p", "q"], n: 5 };
  it("supports equals / notEquals / includes / includesAny / gt", () => {
    expect(evaluate({ question: "a", equals: true }, answers)).toBe(true);
    expect(evaluate({ question: "a", equals: false }, answers)).toBe(false);
    expect(evaluate({ question: "b", notEquals: "y" }, answers)).toBe(true);
    expect(evaluate({ question: "missing", notEquals: "y" }, answers)).toBe(false);
    expect(evaluate({ question: "c", includes: "q" }, answers)).toBe(true);
    expect(evaluate({ question: "c", includes: "z" }, answers)).toBe(false);
    expect(evaluate({ question: "c", includesAny: ["z", "p"] }, answers)).toBe(true);
    expect(evaluate({ question: "n", gt: 4 }, answers)).toBe(true);
    expect(evaluate({ question: "n", gt: 5 }, answers)).toBe(false);
    expect(evaluate({ question: "b", gt: 0 }, answers)).toBe(false);
  });

  it("combines with all / any", () => {
    expect(
      evaluate(
        {
          all: [
            { question: "a", equals: true },
            { question: "n", gt: 1 },
          ],
        },
        answers,
      ),
    ).toBe(true);
    expect(
      evaluate(
        {
          all: [
            { question: "a", equals: true },
            { question: "n", gt: 9 },
          ],
        },
        answers,
      ),
    ).toBe(false);
    expect(
      evaluate(
        {
          any: [
            { question: "a", equals: false },
            { question: "n", gt: 1 },
          ],
        },
        answers,
      ),
    ).toBe(true);
    expect(evaluate({ any: [] }, answers)).toBe(false);
    expect(evaluate({ all: [] }, answers)).toBe(true);
  });
});

describe("questionnaire v1: conditional questions", () => {
  it("starts with only the unconditional questions", () => {
    const visible = ids(QUESTIONNAIRE_V1, {});
    for (const hidden of [
      "workloadsOther",
      "containerCount",
      "vmCount",
      "cameraCount",
      "homeDeviceCount",
      "gpuNeeded",
      "redundancy",
      "storageMedia",
      "maxPowerWatts",
      "remoteMethod",
      "publicExposure",
      "offsiteBackup",
      "rpoHours",
    ]) {
      expect(visible, hidden).not.toContain(hidden);
    }
    for (const shown of [
      "workloads",
      "concurrentUsers",
      "budgetMaxDzd",
      "noiseLevel",
      "growth2y",
    ]) {
      expect(visible, shown).toContain(shown);
    }
  });

  it("reveals workload-specific questions only for the selected workloads", () => {
    expect(ids(QUESTIONNAIRE_V1, { workloads: ["surveillance"] })).toContain("cameraCount");
    expect(ids(QUESTIONNAIRE_V1, { workloads: ["surveillance"] })).not.toContain("vmCount");
    expect(ids(QUESTIONNAIRE_V1, { workloads: ["virtualization", "containers"] })).toEqual(
      expect.arrayContaining(["vmCount", "containerCount"]),
    );
    expect(ids(QUESTIONNAIRE_V1, { workloads: ["home_automation"] })).toContain("homeDeviceCount");
    expect(ids(QUESTIONNAIRE_V1, { workloads: ["other"] })).toContain("workloadsOther");
  });

  it("asks about a GPU only for media, surveillance or dev/test", () => {
    expect(ids(QUESTIONNAIRE_V1, { workloads: ["file_storage"] })).not.toContain("gpuNeeded");
    for (const w of ["media", "surveillance", "dev_test"]) {
      expect(ids(QUESTIONNAIRE_V1, { workloads: [w] }), w).toContain("gpuNeeded");
    }
  });

  it("asks about redundancy and media only when storage is wanted", () => {
    expect(ids(QUESTIONNAIRE_V1, { storageTb: 0 })).not.toContain("redundancy");
    expect(ids(QUESTIONNAIRE_V1, { storageTb: 8 })).toEqual(
      expect.arrayContaining(["redundancy", "storageMedia"]),
    );
  });

  it("asks about power only for always-on servers", () => {
    expect(ids(QUESTIONNAIRE_V1, { alwaysOn: false })).not.toContain("maxPowerWatts");
    expect(ids(QUESTIONNAIRE_V1, { alwaysOn: true })).toContain("maxPowerWatts");
  });

  it("asks about remote access and backup details only when needed", () => {
    expect(ids(QUESTIONNAIRE_V1, { needsRemoteAccess: false })).not.toContain("remoteMethod");
    expect(ids(QUESTIONNAIRE_V1, { needsRemoteAccess: true })).toEqual(
      expect.arrayContaining(["remoteMethod", "publicExposure"]),
    );
    expect(ids(QUESTIONNAIRE_V1, { needsBackup: false })).not.toContain("rpoHours");
    expect(ids(QUESTIONNAIRE_V1, { needsBackup: true })).toEqual(
      expect.arrayContaining(["offsiteBackup", "rpoHours"]),
    );
  });
});

describe("validateAnswers()", () => {
  it("accepts a complete minimal response", () => {
    const result = validateAnswers(QUESTIONNAIRE_V1, BASE, { complete: true });
    expect(result.errors).toEqual({});
    expect(result.ok).toBe(true);
  });

  it("lets a draft be incomplete but still checks the types of what was answered", () => {
    expect(validateAnswers(QUESTIONNAIRE_V1, {}, { complete: false }).ok).toBe(true);
    const bad = validateAnswers(
      QUESTIONNAIRE_V1,
      { concurrentUsers: "many" as never },
      { complete: false },
    );
    expect(bad.errors.concurrentUsers).toBe("invalid_type");
  });

  it("requires every visible required question when completing", () => {
    const result = validateAnswers(QUESTIONNAIRE_V1, {}, { complete: true });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(
      [
        "alwaysOn",
        "budgetMaxDzd",
        "concurrentUsers",
        "cpuPriority",
        "growth2y",
        "needsBackup",
        "needsRemoteAccess",
        "noiseLevel",
        "storageTb",
        "workloads",
      ].sort(),
    );
    expect(Object.values(result.errors).every((c) => c === "required")).toBe(true);
  });

  it("requires newly revealed required questions", () => {
    const surveillance = validateAnswers(
      QUESTIONNAIRE_V1,
      { ...BASE, workloads: ["surveillance"] },
      { complete: true },
    );
    expect(surveillance.errors).toEqual({ cameraCount: "required" });

    const remote = validateAnswers(
      QUESTIONNAIRE_V1,
      { ...BASE, needsRemoteAccess: true },
      { complete: true },
    );
    expect(remote.errors).toEqual({ remoteMethod: "required" });
  });

  it("never requires hidden questions", () => {
    const result = validateAnswers(
      QUESTIONNAIRE_V1,
      { ...BASE, workloads: ["file_storage"] },
      { complete: true },
    );
    expect(result.errors.cameraCount).toBeUndefined();
    expect(result.errors.remoteMethod).toBeUndefined();
  });

  it("drops answers to questions that are no longer visible", () => {
    const answers: Answers = {
      ...BASE,
      needsRemoteAccess: false,
      remoteMethod: "tailscale", // stale: the question is hidden now
      publicExposure: true, // stale
      workloads: ["file_storage"],
      cameraCount: 8, // stale
    };
    const result = validateAnswers(QUESTIONNAIRE_V1, answers, { complete: true });
    expect(result.ok).toBe(true);
    expect(result.answers.remoteMethod).toBeUndefined();
    expect(result.answers.publicExposure).toBeUndefined();
    expect(result.answers.cameraCount).toBeUndefined();
  });

  it("does not let a stale hidden answer reveal a dependent question", () => {
    // 'storageTb' > 0 would reveal 'redundancy', but a hidden parent must not count.
    const def: QuestionnaireDefinition = {
      version: 99,
      sections: [
        {
          id: "s",
          questions: [
            { id: "gate", kind: "boolean" },
            { id: "hiddenParent", kind: "number", showIf: { question: "gate", equals: true } },
            {
              id: "child",
              kind: "boolean",
              required: true,
              showIf: { question: "hiddenParent", gt: 0 },
            },
          ],
        },
      ],
    };
    const result = validateAnswers(def, { gate: false, hiddenParent: 5 }, { complete: true });
    expect(result.ok).toBe(true);
    expect(ids(def, { gate: false, hiddenParent: 5 })).toEqual(["gate"]);
  });

  it("rejects unknown options and wrong types", () => {
    expect(
      validateAnswers(QUESTIONNAIRE_V1, { ...BASE, cpuPriority: "turbo" }, { complete: true })
        .errors.cpuPriority,
    ).toBe("invalid_option");
    expect(
      validateAnswers(
        QUESTIONNAIRE_V1,
        { ...BASE, workloads: ["file_storage", "mining"] },
        { complete: true },
      ).errors.workloads,
    ).toBe("invalid_option");
    expect(
      validateAnswers(QUESTIONNAIRE_V1, { ...BASE, alwaysOn: "yes" as never }, { complete: true })
        .errors.alwaysOn,
    ).toBe("invalid_type");
    expect(
      validateAnswers(
        QUESTIONNAIRE_V1,
        { ...BASE, workloads: "file_storage" as never },
        { complete: true },
      ).errors.workloads,
    ).toBe("invalid_type");
  });

  it("enforces numeric bounds and integers", () => {
    const check = (patch: Answers) =>
      validateAnswers(QUESTIONNAIRE_V1, { ...BASE, ...patch }, { complete: true }).errors;
    expect(check({ concurrentUsers: 0 }).concurrentUsers).toBe("too_small");
    expect(check({ concurrentUsers: 5000 }).concurrentUsers).toBe("too_large");
    expect(check({ concurrentUsers: 2.5 }).concurrentUsers).toBe("not_integer");
    expect(check({ storageTb: -1 }).storageTb).toBe("too_small");
    expect(check({ storageTb: Number.NaN })).not.toHaveProperty("storageTb", "invalid_type"); // NaN is treated as unanswered -> required
    expect(check({ storageTb: Number.POSITIVE_INFINITY }).storageTb).toBe("invalid_type");
  });

  it("checks that the maximum budget is not below the minimum", () => {
    const errors = (min: number, max: number) =>
      validateAnswers(
        QUESTIONNAIRE_V1,
        { ...BASE, budgetMinDzd: min, budgetMaxDzd: max },
        { complete: true },
      ).errors;
    expect(errors(100000, 50000).budgetMaxDzd).toBe("below_minimum_question");
    expect(errors(50000, 50000)).toEqual({});
    expect(errors(0, 80000)).toEqual({});
  });

  it("limits text length and trims it", () => {
    const long = validateAnswers(
      QUESTIONNAIRE_V1,
      { ...BASE, notes: "x".repeat(1001) },
      { complete: true },
    );
    expect(long.errors.notes).toBe("too_long");
    const trimmed = validateAnswers(
      QUESTIONNAIRE_V1,
      { ...BASE, notes: "  hello  " },
      { complete: true },
    );
    expect(trimmed.answers.notes).toBe("hello");
  });

  it("treats empty strings and arrays as unanswered, and removes duplicates", () => {
    const result = validateAnswers(
      QUESTIONNAIRE_V1,
      { ...BASE, notes: "", workloads: ["media", "media", "file_storage"] },
      { complete: true },
    );
    expect(result.answers.notes).toBeUndefined();
    expect(result.answers.workloads).toEqual(["media", "file_storage"]);
    expect(
      validateAnswers(QUESTIONNAIRE_V1, { ...BASE, workloads: [] }, { complete: true }).errors
        .workloads,
    ).toBe("required");
  });

  it("ignores answers to unknown questions", () => {
    const result = validateAnswers(
      QUESTIONNAIRE_V1,
      { ...BASE, nonsense: "x", __proto__x: 1 } as Answers,
      { complete: true },
    );
    expect(result.answers).not.toHaveProperty("nonsense");
    expect(result.ok).toBe(true);
  });

  it("is deterministic and does not mutate its input", () => {
    const input: Answers = { ...BASE, notes: "  hi " };
    const copy = structuredClone(input);
    const a = validateAnswers(QUESTIONNAIRE_V1, input, { complete: true });
    const b = validateAnswers(QUESTIONNAIRE_V1, input, { complete: true });
    expect(a).toEqual(b);
    expect(input).toEqual(copy);
  });
});

describe("normalizeAnswers()", () => {
  it("keeps only visible, non-blank answers", () => {
    expect(
      normalizeAnswers(QUESTIONNAIRE_V1, { workloads: ["media"], cameraCount: 3, notes: "" }),
    ).toEqual({
      workloads: ["media"],
    });
  });
});

describe("questionnaire registry", () => {
  it("has a definition for every version up to the latest", () => {
    for (let v = 1; v <= LATEST_VERSION; v++) expect(getDefinition(v), `v${v}`).toBeDefined();
    expect(Object.keys(QUESTIONNAIRES).map(Number).sort()).toEqual(
      Array.from({ length: LATEST_VERSION }, (_, i) => i + 1),
    );
    expect(getDefinition(LATEST_VERSION + 1)).toBeUndefined();
  });

  it("keeps every definition internally consistent", () => {
    for (const def of Object.values(QUESTIONNAIRES)) {
      const questions = allQuestions(def);
      const seen = new Set<string>();
      for (const q of questions) {
        expect(seen.has(q.id), `duplicate id ${q.id}`).toBe(false);
        seen.add(q.id);
      }
      // A condition may only depend on a question defined EARLIER in the questionnaire.
      const defined = new Set<string>();
      const refs = (c: unknown): string[] => {
        const cond = c as Record<string, unknown>;
        if (Array.isArray(cond.all)) return (cond.all as unknown[]).flatMap(refs);
        if (Array.isArray(cond.any)) return (cond.any as unknown[]).flatMap(refs);
        return typeof cond.question === "string" ? [cond.question] : [];
      };
      for (const q of questions) {
        if (q.showIf)
          for (const ref of refs(q.showIf))
            expect(defined.has(ref), `${q.id} depends on later/unknown ${ref}`).toBe(true);
        if (q.kind === "number" && q.atLeast)
          expect(defined.has(q.atLeast), `${q.id}.atLeast`).toBe(true);
        defined.add(q.id);
      }
      for (const q of questions) {
        if (q.kind === "single" || q.kind === "multi") {
          expect(q.options.length).toBeGreaterThan(0);
          expect(new Set(q.options).size).toBe(q.options.length);
        }
      }
    }
  });
});
