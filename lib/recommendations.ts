import type { PreferredWorkMode } from "@/types/internship";

export interface RecommendationPreferences {
  preferred_roles: string[];
  preferred_work_modes: PreferredWorkMode[];
  preferred_locations: string[];
  skills: string[];
  graduation_year?: number | null;
  experience_level?: string | null;
}

export interface RecommendationInternship {
  id: string;
  company: string | null;
  role: string | null;
  location: string | null;
  work_mode: PreferredWorkMode | null;
  required_skills: unknown;
  posted_date?: string | null;
  source_url?: string | null;
  application_url?: string | null;
  status: "active" | "closed" | "expired";
  last_verified_at: string | null;
  created_at: string;
}

export interface InternshipRecommendation {
  internship: RecommendationInternship;
  score: number;
  reasons: string[];
}

const WEIGHTS = { role: 35, skills: 30, workMode: 15, location: 20 } as const;
const MAX_FRESHNESS_DAYS = 30;

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function includesMatch(value: string | null, candidates: string[]): boolean {
  if (!value) return false;
  const normalizedValue = normalize(value);
  return candidates.some((candidate) => {
    const normalizedCandidate = normalize(candidate);
    return normalizedCandidate === normalizedValue || normalizedValue.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedValue);
  });
}

function skillsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((skill): skill is string => typeof skill === "string" && skill.trim().length > 0);
}

function isFreshEnough(internship: RecommendationInternship): boolean {
  if (internship.status !== "active") return false;
  const timestamp = Date.parse(internship.last_verified_at ?? internship.created_at);
  if (!Number.isFinite(timestamp)) return false;
  return Date.now() - timestamp <= MAX_FRESHNESS_DAYS * 24 * 60 * 60 * 1000;
}

export function scoreInternshipRecommendation(
  internship: RecommendationInternship,
  preferences: RecommendationPreferences,
): InternshipRecommendation {
  const reasons: string[] = [];
  const roles = preferences.preferred_roles.filter(Boolean);
  const modes = preferences.preferred_work_modes.filter(Boolean);
  const locations = preferences.preferred_locations.filter(Boolean);
  const userSkills = preferences.skills.filter(Boolean);
  const requiredSkills = skillsFrom(internship.required_skills);

  const roleMatched = roles.length === 0 || includesMatch(internship.role, roles);
  if (roles.length > 0 && roleMatched) reasons.push("Matches your preferred role");

  const matchingSkills = requiredSkills.filter((skill) => includesMatch(skill, userSkills));
  const skillsScore = userSkills.length === 0 ? WEIGHTS.skills : Math.min(WEIGHTS.skills, Math.round((matchingSkills.length / userSkills.length) * WEIGHTS.skills));
  if (matchingSkills.length > 0) reasons.push(`Matches ${matchingSkills.length} of your skills`);

  const modeMatched = modes.length === 0 || (internship.work_mode !== null && modes.includes(internship.work_mode));
  if (modes.length > 0 && modeMatched && internship.work_mode) reasons.push(`${internship.work_mode.charAt(0).toUpperCase() + internship.work_mode.slice(1)} work preference`);

  const locationMatched = locations.length === 0 || includesMatch(internship.location, locations);
  if (locations.length > 0 && locationMatched) reasons.push("Matches your preferred location");

  const score = Math.max(0, Math.min(100, (roleMatched ? WEIGHTS.role : 0) + skillsScore + (modeMatched ? WEIGHTS.workMode : 0) + (locationMatched ? WEIGHTS.location : 0)));
  return { internship, score, reasons };
}

export function getInternshipRecommendations(
  internships: RecommendationInternship[],
  preferences: RecommendationPreferences,
  excludedIds: Set<string>,
): InternshipRecommendation[] {
  return internships
    .filter((internship) => !excludedIds.has(internship.id) && isFreshEnough(internship))
    .map((internship) => scoreInternshipRecommendation(internship, preferences))
    .filter((recommendation) => recommendation.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftDate = Date.parse(left.internship.last_verified_at ?? left.internship.created_at);
      const rightDate = Date.parse(right.internship.last_verified_at ?? right.internship.created_at);
      return rightDate - leftDate;
    });
}
