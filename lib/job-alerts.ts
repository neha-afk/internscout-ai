import { createPersistenceClient } from "@/lib/internships";
import type { JobAlert, PreferredWorkMode } from "@/types/internship";

type AlertInternship = {
  source_url: string;
  role: string | null;
  required_skills: unknown;
  work_mode: PreferredWorkMode | null;
  location: string | null;
};

export type JobAlertMatchEvaluation = {
  isMatch: boolean;
  score: number;
  reasons: string[];
};

const DEFAULT_MATCH_THRESHOLD = 50;

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined): string[] {
  return [...new Set(normalizeText(value).split(" ").filter(Boolean))];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function rolePoints(alert: JobAlert, internship: AlertInternship, reasons: string[]): number {
  if (alert.roles.length === 0) {
    reasons.push("Role preference is open.");
    return 35;
  }
  const internshipRole = normalizeText(internship.role);
  const bestRatio = Math.max(
    ...alert.roles.map((role) => {
      const requested = normalizeText(role);
      if (!requested || !internshipRole) return 0;
      if (internshipRole.includes(requested) || requested.includes(internshipRole)) return 1;
      const requestedTokens = tokens(requested);
      const overlap = requestedTokens.filter((token) => internshipRole.includes(token)).length;
      return requestedTokens.length ? overlap / requestedTokens.length : 0;
    }),
    0
  );
  if (bestRatio === 1) reasons.push("Role matches the alert.");
  else if (bestRatio > 0) reasons.push("Role partially matches the alert.");
  return Math.round(bestRatio * 35);
}

function skillPoints(alert: JobAlert, internship: AlertInternship, reasons: string[]): number {
  if (alert.skills.length === 0) {
    reasons.push("Skill preference is open.");
    return 30;
  }
  const required = stringArray(internship.required_skills).map(normalizeText).filter(Boolean);
  const matched = alert.skills.filter((skill) => {
    const normalized = normalizeText(skill);
    return normalized && required.some((item) => item === normalized || item.includes(normalized) || normalized.includes(item));
  }).length;
  if (matched > 0) reasons.push(`${matched} alert skill${matched === 1 ? "" : "s"} matched.`);
  return Math.round((matched / alert.skills.length) * 30);
}

function workModePoints(alert: JobAlert, internship: AlertInternship, reasons: string[]): number {
  if (alert.work_modes.length === 0) return 15;
  if (!internship.work_mode) {
    reasons.push("Work mode is unknown.");
    return 7;
  }
  if (alert.work_modes.includes(internship.work_mode)) {
    reasons.push("Work mode matches the alert.");
    return 15;
  }
  return 0;
}

function locationPoints(alert: JobAlert, internship: AlertInternship, reasons: string[]): number {
  if (alert.locations.length === 0) return 20;
  if (internship.work_mode === "remote" && alert.work_modes.includes("remote")) {
    reasons.push("Remote internship is compatible with the alert.");
    return 20;
  }
  if (!internship.location) return 10;
  const location = normalizeText(internship.location);
  const matches = alert.locations.some((requested) => {
    const normalized = normalizeText(requested);
    return normalized && (location.includes(normalized) || normalized.includes(location));
  });
  if (matches) {
    reasons.push("Location matches the alert.");
    return 20;
  }
  return 0;
}

export function evaluateJobAlertMatch(
  alert: JobAlert,
  internship: AlertInternship
): JobAlertMatchEvaluation {
  const reasons: string[] = [];
  const score = Math.max(
    0,
    Math.min(
      100,
      rolePoints(alert, internship, reasons) +
        skillPoints(alert, internship, reasons) +
        workModePoints(alert, internship, reasons) +
        locationPoints(alert, internship, reasons)
    )
  );
  const threshold = alert.minimum_match_score ?? DEFAULT_MATCH_THRESHOLD;
  return { isMatch: score >= threshold, score, reasons: [...new Set(reasons)] };
}

function safeAlert(value: JobAlert): JobAlert {
  return {
    ...value,
    roles: Array.isArray(value.roles) ? value.roles.filter((item) => typeof item === "string") : [],
    work_modes: Array.isArray(value.work_modes) ? value.work_modes.filter((item): item is PreferredWorkMode => ["remote", "hybrid", "onsite"].includes(item)) : [],
    locations: Array.isArray(value.locations) ? value.locations.filter((item) => typeof item === "string") : [],
    skills: Array.isArray(value.skills) ? value.skills.filter((item) => typeof item === "string") : [],
  };
}

// Intended for future scheduled/background execution; it is not called during searches.
export async function detectJobAlertMatches(): Promise<{
  alertsProcessed: number;
  internshipsChecked: number;
  newMatchesCreated: number;
}> {
  const supabase = createPersistenceClient();
  const [{ data: alerts, error: alertsError }, { data: internships, error: internshipsError }] = await Promise.all([
    supabase.from("job_alerts").select("*").eq("is_active", true),
    supabase.from("internships").select("source_url, role, required_skills, work_mode, location").eq("status", "active"),
  ]);
  if (alertsError) throw new Error(`Unable to fetch job alerts: ${alertsError.message}`);
  if (internshipsError) throw new Error(`Unable to fetch internships: ${internshipsError.message}`);

  let alertsProcessed = 0;
  let internshipsChecked = 0;
  let newMatchesCreated = 0;
  for (const rawAlert of (alerts ?? []) as JobAlert[]) {
    try {
      const alert = safeAlert(rawAlert);
      const activeInternships = (internships ?? []) as AlertInternship[];
      for (const internship of activeInternships) {
        const evaluation = evaluateJobAlertMatch(alert, internship);
        if (!evaluation.isMatch) continue;
        const { data: existing, error: existingError } = await supabase
          .from("job_alert_matches")
          .select("id")
          .eq("alert_id", alert.id)
          .eq("internship_source_url", internship.source_url)
          .maybeSingle();
        if (existingError) throw existingError;
        if (existing) continue;
        const { data: inserted, error: insertError } = await supabase
          .from("job_alert_matches")
          .upsert(
            {
              alert_id: alert.id,
              internship_source_url: internship.source_url,
              match_score: evaluation.score,
              matched_reasons: evaluation.reasons,
            },
            { onConflict: "alert_id,internship_source_url", ignoreDuplicates: true }
          )
          .select("id")
          .maybeSingle();
        if (insertError) throw insertError;
        if (inserted) newMatchesCreated += 1;
      }
      internshipsChecked += activeInternships.length;
      const { error: checkedError } = await supabase
        .from("job_alerts")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("id", alert.id);
      if (checkedError) throw checkedError;
      alertsProcessed += 1;
    } catch {
      continue;
    }
  }
  return { alertsProcessed, internshipsChecked, newMatchesCreated };
}
