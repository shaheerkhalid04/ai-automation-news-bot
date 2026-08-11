import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Scheduled entrypoint, wired to the every-6-hours cron in vercel.json.
 * Vercel signs its cron calls with CRON_SECRET; when that is set we require it
 * so the endpoint cannot be triggered by anyone who finds the URL.
 */
export async function GET(request: Request) {
  const secret = config.cronSecret;
  if (secret) {
    const authorised =
      request.headers.get("authorization") === `Bearer ${secret}` ||
      new URL(request.url).searchParams.get("secret") === secret;
    if (!authorised) {
      return NextResponse.json({ error: "unauthorised" }, { status: 401 });
    }
  }

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
