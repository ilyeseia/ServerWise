/**
 * Project rules as pure functions: the state machines, dependency checks and the initial task
 * template. No I/O here, so every rule is unit-tested; the service applies them inside
 * transactions and the database repeats the structural ones (CHECKs, triggers).
 */

// ---------------------------------------------------------------------------------------------
// Project lifecycle
// ---------------------------------------------------------------------------------------------

export const PROJECT_STATUSES = [
  "planned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/**
 *   planned ─▶ in_progress ─▶ completed (final)
 *      │          │  ▲
 *      │          ▼  │
 *      │        on_hold
 *      ╰── any unfinished state ─▶ cancelled (final)
 */
const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
};

export function allowedNextProjectStatuses(from: ProjectStatus): readonly ProjectStatus[] {
  return PROJECT_TRANSITIONS[from];
}

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

export const isProjectClosed = (status: ProjectStatus) =>
  status === "completed" || status === "cancelled";

export type ProjectBlocker =
  "ROLLBACK_PLAN_REQUIRED" | "TASKS_OPEN" | "HANDOVER_REQUIRED" | "NO_TASKS";

export interface ProjectFacts {
  rollbackPlan: string | null;
  handoverRecorded: boolean;
  tasks: readonly { status: TaskStatus }[];
}

/** What stops a project from entering `to`. An empty list means the move is allowed. */
export function projectBlockers(to: ProjectStatus, facts: ProjectFacts): ProjectBlocker[] {
  const blockers: ProjectBlocker[] = [];
  if (to === "in_progress" && !facts.rollbackPlan?.trim()) {
    blockers.push("ROLLBACK_PLAN_REQUIRED");
  }
  if (to === "completed") {
    if (facts.tasks.length === 0) blockers.push("NO_TASKS");
    if (facts.tasks.some((task) => task.status !== "done" && task.status !== "cancelled")) {
      blockers.push("TASKS_OPEN");
    }
    if (!facts.handoverRecorded) blockers.push("HANDOVER_REQUIRED");
  }
  return blockers;
}

// ---------------------------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------------------------

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["in_progress", "cancelled"],
  in_progress: ["blocked", "done", "todo", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  done: ["in_progress"], // reopen
  cancelled: ["todo"], // restore
};

export function allowedNextTaskStatuses(from: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[from];
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export type TaskBlocker = "DEPENDENCY_OPEN" | "CHECKLIST_OPEN";

export interface TaskFacts {
  /** Statuses of the tasks this task depends on. */
  dependencyStatuses: readonly TaskStatus[];
  /** Checklist items: `done` flags. */
  checklist: readonly { done: boolean }[];
}

/**
 * What stops a task from entering `to`: work cannot start before its prerequisites are finished,
 * and a task is not done while its checklist has unchecked items. Cancelled prerequisites count
 * as finished (they are no longer expected).
 */
export function taskBlockers(to: TaskStatus, facts: TaskFacts): TaskBlocker[] {
  const blockers: TaskBlocker[] = [];
  if (to === "in_progress" || to === "done") {
    if (facts.dependencyStatuses.some((s) => s !== "done" && s !== "cancelled")) {
      blockers.push("DEPENDENCY_OPEN");
    }
  }
  if (to === "done" && facts.checklist.some((item) => !item.done)) {
    blockers.push("CHECKLIST_OPEN");
  }
  return blockers;
}

// ---------------------------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------------------------

export interface DependencyEdge {
  taskId: string;
  dependsOnId: string;
}

/**
 * True if making `taskId` depend on `dependsOnId` would create a cycle (including depending on
 * itself): that happens exactly when `dependsOnId` already depends, directly or not, on `taskId`.
 */
export function wouldCreateCycle(
  edges: readonly DependencyEdge[],
  taskId: string,
  dependsOnId: string,
): boolean {
  if (taskId === dependsOnId) return true;
  const prerequisites = new Map<string, string[]>();
  for (const edge of edges) {
    prerequisites.set(edge.taskId, [...(prerequisites.get(edge.taskId) ?? []), edge.dependsOnId]);
  }
  const seen = new Set<string>();
  const stack = [dependsOnId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === taskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(prerequisites.get(current) ?? []));
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Initial tasks, generated once from the accepted quotation
// ---------------------------------------------------------------------------------------------

export type TemplateLocale = "ar" | "fr";
export type TemplateKind = "survey" | "rollback" | "work" | "test" | "handover";

export interface QuoteLineLike {
  kind: "hardware" | "labor" | "service" | "other";
  description: string;
}

export interface TemplateTask {
  kind: TemplateKind;
  title: string;
  checklist: string[];
  /** Indexes (into the returned array) of the tasks this one depends on. */
  dependsOn: number[];
}

const TEXT = {
  ar: {
    survey: "معاينة الموقع والتحقق من المتطلبات",
    surveyItems: [
      "تأكيد موقع التركيب والتيار الكهربائي والتبريد",
      "التحقق من الشبكة وسرعة الإنترنت المتاحة",
      "الاتفاق مع العميل على موعد التنفيذ",
    ],
    rollback: "إعداد خطة التراجع واعتمادها",
    rollbackItems: [
      "توثيق الحالة الحالية قبل أي تغيير",
      "التأكد من وجود نسخة احتياطية قابلة للاستعادة",
      "تحديد خطوات العودة إلى الوضع السابق",
    ],
    procure: (d: string) => `توفير وتجهيز: ${d}`,
    carry: (d: string) => `تنفيذ: ${d}`,
    test: "اختبار التركيب والتحقق منه",
    testItems: [
      "اختبار الخدمات الأساسية واستعادة نسخة احتياطية تجريبية",
      "اختبار الوصول عن بُعد والصلاحيات",
      "تسجيل نتائج الاختبار",
    ],
    handover: "التسليم وتدريب العميل",
    handoverItems: [
      "تسليم التوثيق وخطة التراجع للعميل",
      "تدريب العميل على التشغيل الأساسي",
      "تسليم بيانات الدخول عبر قناة آمنة (دون تخزينها هنا)",
    ],
  },
  fr: {
    survey: "Visite du site et vérification des prérequis",
    surveyItems: [
      "Confirmer l'emplacement, l'alimentation électrique et le refroidissement",
      "Vérifier le réseau et le débit Internet disponible",
      "Convenir avec le client de la date d'intervention",
    ],
    rollback: "Préparer et faire valider le plan de retour arrière",
    rollbackItems: [
      "Documenter l'état actuel avant tout changement",
      "S'assurer qu'une sauvegarde restaurable existe",
      "Définir les étapes pour revenir à l'état précédent",
    ],
    procure: (d: string) => `Approvisionner et préparer : ${d}`,
    carry: (d: string) => `Réaliser : ${d}`,
    test: "Tester et valider l'installation",
    testItems: [
      "Tester les services essentiels et restaurer une sauvegarde d'essai",
      "Tester l'accès à distance et les droits",
      "Consigner les résultats des tests",
    ],
    handover: "Livraison et formation du client",
    handoverItems: [
      "Remettre la documentation et le plan de retour arrière au client",
      "Former le client à l'exploitation de base",
      "Transmettre les identifiants par un canal sûr (sans les enregistrer ici)",
    ],
  },
} as const;

/**
 * The standard task list for a project: survey and rollback plan first, one task per quotation
 * line (hardware is procured, everything else is carried out), then testing and handover.
 * Deterministic: the same quotation always produces the same list.
 */
export function buildInitialTasks(
  lines: readonly QuoteLineLike[],
  locale: TemplateLocale,
): TemplateTask[] {
  const t = TEXT[locale];
  const tasks: TemplateTask[] = [
    { kind: "survey", title: t.survey, checklist: [...t.surveyItems], dependsOn: [] },
    { kind: "rollback", title: t.rollback, checklist: [...t.rollbackItems], dependsOn: [] },
  ];
  const workIndexes: number[] = [];
  for (const line of lines) {
    const description = line.description.trim().slice(0, 240);
    workIndexes.push(tasks.length);
    tasks.push({
      kind: "work",
      title: line.kind === "hardware" ? t.procure(description) : t.carry(description),
      checklist: [],
      dependsOn: [0, 1],
    });
  }
  const testIndex = tasks.length;
  tasks.push({
    kind: "test",
    title: t.test,
    checklist: [...t.testItems],
    dependsOn: workIndexes.length > 0 ? workIndexes : [0, 1],
  });
  tasks.push({
    kind: "handover",
    title: t.handover,
    checklist: [...t.handoverItems],
    dependsOn: [testIndex],
  });
  return tasks;
}
