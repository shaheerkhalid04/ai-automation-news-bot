import { NextResponse } from "next/server";
import { refuseUnlessAuthorised } from "@/lib/auth";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Scheduled entrypoint, wired to the daily cron in vercel.json. Vercel signs
 * its cron calls with CRON_SECRET. The secret is required, and with none set
 * the endpoint refuses every call, so nobody who finds the URL can file a run.
 */
export async function GET(request: Request) {
  const refused = refuseUnlessAuthorised(request, { allowQuerySecret: true });
  if (refused) return refused;

  try {
    const result = await runPipeline();
    console.log(
      `[cron] run ${result.runId}: fetched ${result.fetched}, published ${result.published}`,
    );
    return NextResponse.json({
      runId: result.runId,
      fetched: result.fetched,
      published: result.published,
      slack: result.slack,
      sheets: result.sheets,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("[cron] pipeline failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "pipeline failed" },
      { status: 500 },
    );
  }
}
