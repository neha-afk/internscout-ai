import { NextResponse } from "next/server";
import { runScheduledDiscovery } from "@/lib/scheduled-discovery";

export async function POST(request: Request) {
  // Production deployments must define CRON_SECRET outside the client bundle.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Scheduled execution is unavailable." }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const summary = await runScheduledDiscovery();
    return NextResponse.json({ success: true, ...summary }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Scheduled discovery failed." }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } });
}
