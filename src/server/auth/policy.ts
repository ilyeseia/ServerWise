import { randomInt } from "node:crypto";

/** Failed password attempts before an account is locked. */
export const MAX_FAILED_LOGINS = 5;
/** Lock duration in minutes. */
export const LOCKOUT_MINUTES = 15;
/** Returned for wrong password, unknown email and locked account alike (no enumeration). */
export const GENERIC_LOGIN_ERROR = "Invalid email or password";

const LOWER = "abcdefghijkmnopqrstuvwxyz"; // no l
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGITS = "23456789"; // no 0, 1
const SYMBOLS = "-_!@#%+=";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

function pick(chars: string): string {
  return chars[randomInt(chars.length)] as string;
}

/**
 * One-time password for new accounts and admin resets: cryptographically random, 16 chars, at
 * least one of each class, no look-alike characters. Shown once; the user must change it.
 */
export function generateTemporaryPassword(length = 16): string {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Fisher–Yates shuffle with a CSPRNG.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j] as string, chars[i] as string];
  }
  return chars.join("");
}
