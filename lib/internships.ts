import { createClient } from "@supabase/supabase-js";
import type { InternshipInsert, SearchFilters, WorkMode } from "@/types/internship";

export const FRESH_DAYS = 3;
export const STALE_DAYS = 14;
export const EXPIRED_DAYS = 30;
const DAYS_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export type InternshipFreshnessStatus = "fresh" | "stale" | "expired";

export interface InternshipFreshness {
  status: InternshipFreshnessStatus;
  ageInDays: number;
}

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

export function getInternshipFreshness(internship: {
  last_verified_at: string | null;
  created_at: string;
}): InternshipFreshness {
  const timestamp = internship.last_verified_at ?? internship.created_at;
  const parsedTimestamp = Date.parse(timestamp);
  const ageInDays = Number.isFinite(parsedTimestamp)
    ? Math.max(
        0,
        Math.floor((Date.now() - parsedTimestamp) / DAYS_IN_MILLISECONDS)
      )
    : Number.POSITIVE_INFINITY;

  if (ageInDays <= FRESH_DAYS) {
    return { status: "fresh", ageInDays };
  }
  if (ageInDays <= STALE_DAYS || ageInDays <= EXPIRED_DAYS) {
    return { status: "stale", ageInDays };
  }
  return { status: "expired", ageInDays };
}

export function createPersistenceClient() {
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

export async function getExistingSourceUrls(sourceUrls: string[]): Promise<Set<string>> {
  if (sourceUrls.length === 0) return new Set();
  const supabase = createPersistenceClient();
  const { data, error } = await supabase
    .from("internships")
    .select("source_url")
    .in("source_url", sourceUrls);
  if (error) throw new Error(`Unable to check internship URLs: ${error.message}`);
  return new Set(
    (data ?? [])
      .map((row) => row.source_url)
      .filter((sourceUrl): sourceUrl is string => typeof sourceUrl === "string")
  );
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
  const freshRows = rows.filter(
    (row) => getInternshipFreshness(row).status === "fresh"
  );
  return requestedLocation
    ? freshRows.filter((row) => matchesLocation(row, requestedLocation))
    : freshRows;
}

// Intended for a future scheduled server-side maintenance job or cron task.
export async function expireStaleInternships(): Promise<number> {
  const supabase = createPersistenceClient();
  const { data, error } = await supabase
    .from("internships")
    .select("id, last_verified_at, created_at")
    .eq("status", "active");

  if (error) {
    throw new Error(`Unable to find expired internships: ${error.message}`);
  }

  const expiredIds = (data ?? [])
    .filter((internship) => getInternshipFreshness(internship).status === "expired")
    .map((internship) => internship.id);

  if (expiredIds.length === 0) {
    return 0;
  }

  const { error: updateError } = await supabase
    .from("internships")
    .update({ status: "expired" })
    .in("id", expiredIds);

  if (updateError) {
    throw new Error(`Unable to expire internships: ${updateError.message}`);
  }

  return expiredIds.length;
}
