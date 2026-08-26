import { NextResponse } from "next/server";
import { detectJobAlertMatches } from "@/lib/job-alerts";

export async function POST(request: Request) {
  // Production deployments must define CRON_SECRET outside the client bundle.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "Scheduled execution is unavailable." },
      { status: 500 }
    );
  }

  const authorization = request.headers.get("authorization");
  const expectedAuthorization = `Bearer ${cronSecret}`;
  if (authorization !== expectedAuthorization) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await detectJobAlertMatches();
    return NextResponse.json(
      {
        success: true,
        alertsProcessed: summary.alertsProcessed,
        internshipsChecked: summary.internshipsChecked,
        newMatchesCreated: summary.newMatchesCreated,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      { error: "Scheduled execution failed." },
      { status: 500 }
    );
  }
}

export function GET() {
  return NextResponse.json(
    { error: "Method not allowed." },
    { status: 405, headers: { Allow: "POST" } }
  );
}
