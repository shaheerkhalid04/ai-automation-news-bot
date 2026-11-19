import { NextResponse } from "next/server";
import { refuseUnlessAuthorised } from "@/lib/auth";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Manual trigger from the dashboard. Needs `Authorization: Bearer <CRON_SECRET>`
 * and is refused outright when CRON_SECRET is not set.
 */
export async function POST(request: Request) {
  const refused = refuseUnlessAuthorised(request);
  if (refused) return refused;

  try {
    const result = await runPipeline();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/run] pipeline failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "pipeline failed" },
      { status: 500 },
    );
  }
}
