# ServerWise — Projects (ProjectFlow): how an accepted quotation gets delivered

Code: `src/modules/projects` (`rules.ts` pure rules, `service.ts` workflow, `schemas.ts` input).

## 1. From quotation to project

- A project is created from a quotation whose revision was **accepted**. Creating it again — a
  double click, a retry, two people at once — returns the same project: `project.quoteId` is unique,
  and a trigger also refuses a project whose quotation has no accepted revision.
- Numbering: `P-YYYY-NNNN`, allocated atomically per year.
- The initial tasks are generated once, deterministically:
  1. Site survey and prerequisites, 2. Prepare and approve the rollback plan,
  2. one task per quotation line (hardware is _procured and prepared_, everything else is _carried out_),
  3. Test and validate, 5. Handover and customer training.
     Work tasks depend on 1 and 2; testing depends on all work; handover depends on testing. Each
     standard task starts with a checklist. Titles are created in the language of the person who
     creates the project and can be edited like any task.

## 2. Project lifecycle

```
planned ─▶ in_progress ⇄ on_hold
              │
              ╰─▶ completed (final)        any unfinished state ─▶ cancelled (final, needs a reason)
```

| Move                    | Allowed when                                                                  |
| ----------------------- | ----------------------------------------------------------------------------- |
| `planned → in_progress` | a **rollback plan** is written (and stays: it can be improved, not erased)    |
| `→ on_hold`             | always (tasks cannot change while paused)                                     |
| `→ completed`           | every task is done or cancelled, there is ≥ 1 task, and a **handover** exists |
| `→ cancelled`           | a reason is given                                                             |

The handover can only be recorded while the project is in progress. It must **not** contain
passwords or VPN keys: write where they are kept (for example "customer's password manager, item 12").
Completed and cancelled projects are frozen — tasks, checklists, milestones and dependencies cannot
change (database triggers), and projects can never be deleted.

## 3. Tasks, checklists, dependencies, milestones

- Task states: `todo`, `in_progress`, `blocked`, `done`, `cancelled`. `todo → done` directly is not
  allowed; a done task can be reopened; a cancelled task can be restored.
- A task **cannot start or finish** while a prerequisite is neither done nor cancelled.
- A task is **not done** while any checklist item is unchecked. Checklists of a done task are
  read-only: reopen it first, so "done" never lies.
- Dependencies stay inside one project and can never form a cycle (checked in code and by a trigger).
- Only tasks that have not started can be deleted; otherwise cancel them.
- Milestones group tasks and can be marked done; deleting one keeps its tasks.
- Progress counts done tasks over non-cancelled tasks.

## 4. Permissions

| Permission       | owner | sales | technician | viewer |
| ---------------- | :---: | :---: | :--------: | :----: |
| `project:read`   |   ✔   |   ✔   |     ✔      |   —    |
| `project:write`  |   ✔   |   ✔   |     ✔      |   —    |
| `project:manage` |   ✔   |   ✔   |     —      |   —    |

`project:manage` covers creating a project, changing its status, plan and manager, and recording
the handover. Every change writes an audit row in the same transaction.

## 5. Not in this stage

Automatic lead status changes when a project is created (the lead stays as the CRM user left it),
scheduling or capacity planning, time tracking, stock reservation (Stage 7), customer-facing
progress pages.
