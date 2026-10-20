import { can, type Permission, type Role } from "./permissions";

export class UnauthorizedError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** A domain rule was violated (for example removing the last owner). Safe to show to users. */
export class RuleViolationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RuleViolationError";
    this.code = code;
  }
}

/** The authenticated user performing an operation. */
export interface Actor {
  id: string;
  email: string;
  name: string;
  role: Role;
}

/** Every guarded service starts with this. Denies by default. */
export function assertCan(
  actor: Actor | null | undefined,
  permission: Permission,
): asserts actor is Actor {
  if (!actor) throw new UnauthorizedError();
  if (!can(actor.role, permission)) throw new ForbiddenError();
}
