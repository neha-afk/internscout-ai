import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { upsertInternship } from "@/lib/internships";
import type { InternshipInsert } from "@/types/internship";

export async function POST(request: Request) {
  const authClient = await createServerClient();
  const { data: authData } = await authClient.auth.getUser();
  if (!authData.user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const items =
    body && typeof body === "object" && Array.isArray((body as { internships?: unknown }).internships)
      ? (body as { internships: unknown[] }).internships
      : null;
  if (!items || items.length === 0 || items.length > 100) {
    return NextResponse.json({ error: "internships must be a non-empty array." }, { status: 400 });
  }

  const settled = await Promise.all(
    items.map(async (value) => {
      if (!value || typeof value !== "object") {
        return { sourceUrl: null, internshipId: null, error: "Invalid internship object." };
      }
      const item = value as Record<string, unknown>;
      const sourceUrl = typeof item.sourceUrl === "string" ? item.sourceUrl.trim() : "";
      if (!sourceUrl) {
        return { sourceUrl: null, internshipId: null, error: "Internship sourceUrl is required." };
      }
      const record: InternshipInsert = {
        company: typeof item.company === "string" ? item.company : null,
        role: typeof item.role === "string" ? item.role : null,
        description: typeof item.description === "string" ? item.description : null,
        location: typeof item.location === "string" ? item.location : null,
        workMode: item.workMode === "remote" || item.workMode === "hybrid" || item.workMode === "onsite" ? item.workMode : null,
        postedDate: typeof item.postedDate === "string" ? item.postedDate : null,
        deadline: typeof item.deadline === "string" ? item.deadline : null,
        duration: typeof item.duration === "string" ? item.duration : null,
        stipend: typeof item.stipend === "string" ? item.stipend : null,
        experienceRequired: typeof item.experienceRequired === "string" ? item.experienceRequired : null,
        graduationRequirements: typeof item.graduationRequirements === "string" ? item.graduationRequirements : null,
        requiredSkills: Array.isArray(item.requiredSkills) ? item.requiredSkills.filter((skill): skill is string => typeof skill === "string") : [],
        applicationUrl: typeof item.applicationUrl === "string" ? item.applicationUrl : null,
        sourceUrl,
        sourceDomain: typeof item.sourceDomain === "string" ? item.sourceDomain : null,
        verificationStatus: null,
        verificationScore: null,
        verificationReasons: [],
        lastVerifiedAt: null,
      };
      try {
        const saved = await upsertInternship(record) as { id?: unknown } | null;
        if (!saved || typeof saved.id !== "string" || !saved.id) {
          return { sourceUrl, internshipId: null, error: "Persistence returned no database ID." };
        }
        return { sourceUrl, internshipId: saved.id, error: null };
      } catch (error) {
        return { sourceUrl, internshipId: null, error: error instanceof Error ? error.message : "Unable to persist internship." };
      }
    })
  );

  return NextResponse.json({
    internships: settled,
  });
}
