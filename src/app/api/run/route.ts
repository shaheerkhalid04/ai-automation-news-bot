import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Manual trigger from the dashboard. */
export async function POST() {
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
