import type {
  AnswerValue,
  Answers,
  Condition,
  Question,
  QuestionnaireDefinition,
  ValidationCode,
  ValidationResult,
} from "./types";

export function evaluate(condition: Condition, answers: Answers): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluate(c, answers));
  if ("any" in condition) return condition.any.some((c) => evaluate(c, answers));

  const value = answers[condition.question];
  if ("equals" in condition) return value === condition.equals;
  if ("notEquals" in condition) return value !== undefined && value !== condition.notEquals;
  if ("includes" in condition) return Array.isArray(value) && value.includes(condition.includes);
  if ("includesAny" in condition) {
    return Array.isArray(value) && condition.includesAny.some((o) => value.includes(o));
  }
  return typeof value === "number" && value > condition.gt;
}

/**
 * Questions that apply for the given answers, in definition order. A question is evaluated
 * against the answers of questions that were themselves visible, so a stale answer to a hidden
 * question can never reveal (or hide) anything else.
 */
export function visibleQuestions(
  definition: QuestionnaireDefinition,
  answers: Answers,
): Question[] {
  const effective: Answers = {};
  const visible: Question[] = [];
  for (const section of definition.sections) {
    for (const question of section.questions) {
      if (question.showIf && !evaluate(question.showIf, effective)) continue;
      visible.push(question);
      const answer = answers[question.id];
      if (answer !== undefined) effective[question.id] = answer;
    }
  }
  return visible;
}

function isBlank(value: AnswerValue | undefined): boolean {
  return (
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

function check(question: Question, value: AnswerValue): ValidationCode | null {
  switch (question.kind) {
    case "boolean":
      return typeof value === "boolean" ? null : "invalid_type";
    case "single":
      if (typeof value !== "string") return "invalid_type";
      return question.options.includes(value) ? null : "invalid_option";
    case "multi":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return "invalid_type";
      return value.every((v) => question.options.includes(v)) ? null : "invalid_option";
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return "invalid_type";
      if (question.integer && !Number.isInteger(value)) return "not_integer";
      if (question.min !== undefined && value < question.min) return "too_small";
      if (question.max !== undefined && value > question.max) return "too_large";
      return null;
    case "text":
      if (typeof value !== "string") return "invalid_type";
      return value.length > question.maxLength ? "too_long" : null;
  }
}

/** Removes answers to hidden/unknown questions and normalizes values (trims text, de-dupes). */
export function normalizeAnswers(definition: QuestionnaireDefinition, answers: Answers): Answers {
  const result: Answers = {};
  for (const question of visibleQuestions(definition, answers)) {
    const raw = answers[question.id];
    if (isBlank(raw)) continue;
    if (question.kind === "text" && typeof raw === "string") result[question.id] = raw.trim();
    else if (question.kind === "multi" && Array.isArray(raw))
      result[question.id] = [...new Set(raw)];
    else result[question.id] = raw as AnswerValue;
  }
  return result;
}

/**
 * Validates answers. A draft only checks the types of what was answered; a complete response
 * additionally requires every visible required question.
 */
export function validateAnswers(
  definition: QuestionnaireDefinition,
  input: Answers,
  options: { complete: boolean },
): ValidationResult {
  const answers = normalizeAnswers(definition, input);
  const errors: Record<string, ValidationCode> = {};

  for (const question of visibleQuestions(definition, answers)) {
    const value = answers[question.id];
    if (value === undefined) {
      if (options.complete && question.required) errors[question.id] = "required";
      continue;
    }
    const problem = check(question, value);
    if (problem) {
      errors[question.id] = problem;
      continue;
    }
    if (question.kind === "number" && question.atLeast) {
      const other = answers[question.atLeast];
      if (typeof other === "number" && typeof value === "number" && value < other) {
        errors[question.id] = "below_minimum_question";
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, answers, errors };
}

export function allQuestions(definition: QuestionnaireDefinition): Question[] {
  return definition.sections.flatMap((s) => [...s.questions]);
}
