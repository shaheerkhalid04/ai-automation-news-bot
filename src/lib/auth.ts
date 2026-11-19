import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { config } from "./config";

function sameSecret(given: string, expected: string): boolean {
  // Hash both sides so the comparison is constant time whatever the lengths.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Guard for anything that files stories. A run sends to Slack and Sheets and
 * spends the Groq allowance, so it must never be open to whoever finds the URL.
 * Fails closed: with no CRON_SECRET set, nothing can trigger a run over HTTP.
 * Returns the response to send when the caller is refused, or null to proceed.
 */
export function refuseUnlessAuthorised(
  request: Request,
  { allowQuerySecret = false } = {},
): NextResponse | null {
  const secret = config.cronSecret;
  if (!secret) {
    return NextResponse.json(
      { error: "runs are disabled until CRON_SECRET is set" },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const query = allowQuerySecret ? (new URL(request.url).searchParams.get("secret") ?? "") : "";

  if ((bearer && sameSecret(bearer, secret)) || (query && sameSecret(query, secret))) {
    return null;
  }
  return NextResponse.json({ error: "unauthorised" }, { status: 401 });
}
