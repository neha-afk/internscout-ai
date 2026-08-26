import { createClient } from "@supabase/supabase-js";
import type { InternshipInsert, SearchFilters, WorkMode } from "@/types/internship";

export interface CachedInternshipRow {
  id: string;
  company: string | null;
  role: string | null;
  description: string | null;
  location: string | null;
  work_mode: WorkMode | null;
  posted_date: string | null;
  deadline: string | null;
  duration: string | null;
  stipend: string | null;
  experience_required: string | null;
  graduation_requirements: string | null;
  required_skills: unknown;
  application_url: string | null;
  source_url: string;
  source_domain: string | null;
  status: "active" | "closed" | "expired";
  verification_status:
    | "verified"
    | "likely_legitimate"
    | "needs_review"
    | "suspicious"
    | null;
  verification_score: number | null;
  verification_reasons: unknown;
  last_verified_at: string | null;
  created_at: string;
}

function createPersistenceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Supabase persistence requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function upsertInternship(internship: InternshipInsert) {
  const supabase = createPersistenceClient();
  const { data, error } = await supabase
    .from("internships")
    .upsert(
      {
        company: internship.company,
        role: internship.role,
        description: internship.description,
        location: internship.location,
        work_mode: internship.workMode,
        posted_date: internship.postedDate,
        deadline: internship.deadline,
        duration: internship.duration,
        stipend: internship.stipend,
        experience_required: internship.experienceRequired,
        graduation_requirements: internship.graduationRequirements,
        required_skills: internship.requiredSkills,
        application_url: internship.applicationUrl,
        source_url: internship.sourceUrl,
        source_domain: internship.sourceDomain,
        status: internship.status ?? "active",
        verification_status: internship.verificationStatus,
        verification_score: internship.verificationScore,
        verification_reasons: internship.verificationReasons,
        last_verified_at: internship.lastVerifiedAt,
      },
      { onConflict: "source_url" }
    )
    .select()
    .single();

  if (error) {
    throw new Error(`Unable to upsert internship: ${error.message}`);
  }

  return data;
}

export async function getInternshipBySourceUrl(sourceUrl: string) {
  const supabase = createPersistenceClient();
  const { data, error } = await supabase
    .from("internships")
    .select("*")
    .eq("source_url", sourceUrl)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to fetch internship: ${error.message}`);
  }

  return data;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function matchesLocation(row: CachedInternshipRow, location: string): boolean {
  if (row.work_mode === "remote") {
    return true;
  }
  if (!row.location) {
    return false;
  }
  const requested = location.toLowerCase().trim();
  const available = row.location.toLowerCase().trim();
  return available.includes(requested) || requested.includes(available);
}

export async function getCachedInternships(
  filters: SearchFilters
): Promise<CachedInternshipRow[]> {
  const supabase = createPersistenceClient();
  let query = supabase
    .from("internships")
    .select(
      "id, company, role, description, location, work_mode, posted_date, deadline, duration, stipend, experience_required, graduation_requirements, required_skills, application_url, source_url, source_domain, status, verification_status, verification_score, verification_reasons, last_verified_at, created_at"
    )
    .eq("status", "active")
    .ilike("role", `%${escapeLikePattern(filters.role.trim())}%`)
    .order("verification_score", { ascending: false, nullsFirst: false })
    .order("last_verified_at", { ascending: false, nullsFirst: false })
    .limit(50);

  if (filters.workMode) {
    query = query.eq("work_mode", filters.workMode);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to fetch cached internships: ${error.message}`);
  }

  const rows = (data ?? []) as CachedInternshipRow[];
  const requestedLocation = filters.location?.trim();
  return requestedLocation
    ? rows.filter((row) => matchesLocation(row, requestedLocation))
    : rows;
}
