import type { ClientInfo } from "@/server/audit";
import type { Actor } from "@/server/authz/guard";
import { RuleViolationError } from "@/server/authz/guard";

/** Who is acting and from where. Services check permissions first, then touch the database. */
export interface CrmContext {
  actor: Actor | null | undefined;
  client?: Partial<ClientInfo>;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const notFound = (what: string) => new RuleViolationError("NOT_FOUND", `${what} not found`);

/** Prisma returns `null` for absent optional fields; the schemas use `undefined`. */
export const orNull = <T>(value: T | undefined): T | null => (value === undefined ? null : value);
