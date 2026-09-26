import { NextResponse } from "next/server";
import { runPatchScout } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const repoUrl =
      typeof body?.repoUrl === "string" ? body.repoUrl.trim() : "";
    const incident =
      typeof body?.incident === "string" ? body.incident.trim() : "";

    if (!repoUrl || !incident) {
      return NextResponse.json(
        { error: "Repository URL and incident details are required." },
        { status: 400 },
      );
    }

    const result = await runPatchScout({ repoUrl, incident });
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "PatchScout failed unexpectedly.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
