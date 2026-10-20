export type Scalar = string | number | boolean;
export type AnswerValue = Scalar | string[];
export type Answers = Record<string, AnswerValue>;

/** A condition on earlier answers. Combine with `all` / `any`. */
export type Condition =
  | { question: string; equals: Scalar }
  | { question: string; notEquals: Scalar }
  | { question: string; includes: string }
  | { question: string; includesAny: readonly string[] }
  | { question: string; gt: number }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] };

interface QuestionBase {
  /** Stable id: also the key in stored answers and in the translation files. */
  id: string;
  required?: boolean;
  /** Shown only when this holds for the answers of the questions above it. */
  showIf?: Condition;
}

export type Question =
  | (QuestionBase & { kind: "boolean" })
  | (QuestionBase & { kind: "single"; options: readonly string[] })
  | (QuestionBase & { kind: "multi"; options: readonly string[] })
  | (QuestionBase & {
      kind: "number";
      min?: number;
      max?: number;
      integer?: boolean;
      /** Must be >= the answer to this other question (for example budget max >= min). */
      atLeast?: string;
    })
  | (QuestionBase & { kind: "text"; maxLength: number });

export interface Section {
  id: string;
  questions: readonly Question[];
}

export interface QuestionnaireDefinition {
  version: number;
  sections: readonly Section[];
}

export type ValidationCode =
  | "required"
  | "invalid_type"
  | "invalid_option"
  | "too_small"
  | "too_large"
  | "too_long"
  | "not_integer"
  | "below_minimum_question";

export interface ValidationResult {
  ok: boolean;
  /** Answers of visible questions only, in a normalized form. */
  answers: Answers;
  /** Error code per question id. */
  errors: Record<string, ValidationCode>;
}
