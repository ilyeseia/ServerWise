"use client";

import { z } from "zod";

// Zod probes whether it may compile validators with `new Function`, which the page's
// Content-Security-Policy (no 'unsafe-eval') forbids and reports as a violation. Turning the
// compiled fast path off in the browser removes the probe; validators behave identically.
z.config({ jitless: true });
