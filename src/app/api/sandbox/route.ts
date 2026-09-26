import { NextResponse } from "next/server";
import { probeSandboxAccess } from "@/lib/sandbox";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const probe = await probeSandboxAccess();
  return NextResponse.json({
    ready: probe.ok,
    message: probe.message,
  });
}
