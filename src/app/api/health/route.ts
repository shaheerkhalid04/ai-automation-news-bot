import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { verifyModel } from "@/lib/groq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness by default. With ?verify=1 it also makes one tiny real call to the
 * summariser's model and returns { ok, model, latency_ms }, so a monitor can
 * tell a running server from a working one.
 */
export async function GET(request: Request) {
  const verify = new URL(request.url).searchParams.get("verify") === "1";
  if (!verify) {
    return NextResponse.json({ ok: true, model: config.groqModel, llm: config.llmEnabled });
  }
  return NextResponse.json(await verifyModel(), {
    headers: { "Cache-Control": "no-store" },
  });
}
