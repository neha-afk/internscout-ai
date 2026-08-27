export type WorkMode = "remote" | "hybrid" | "onsite";

export type ExperienceRange = "0" | "0-1" | "1-2" | "2+";

export interface SearchFilters {
  role: string;
  graduationYear: number;
  postedWithinDays: number;
  paidOnly: boolean;
  skills?: string[];
  location?: string;
  workMode?: WorkMode;
  experience?: ExperienceRange;
  minStipend?: number;
}

export type InternshipStatus = "active" | "closed" | "expired";

export type ApplicationStatus =
  | "saved"
  | "applied"
  | "assessment"
  | "interview"
  | "offer"
  | "rejected";

export type ExperienceLevel =
  | "fresher"
  | "beginner"
  | "intermediate"
  | "experienced";

export type PreferredWorkMode = WorkMode;

export interface UserPreferences {
  id?: string;
  user_id?: string;
  preferred_roles: string[];
  preferred_work_modes: PreferredWorkMode[];
  preferred_locations: string[];
  skills: string[];
  graduation_year: number | null;
  experience_level: ExperienceLevel | null;
  created_at?: string;
  updated_at?: string;
}

export interface JobAlert {
  id: string;
  user_id: string;
  name: string;
  roles: string[];
  work_modes: PreferredWorkMode[];
  locations: string[];
  skills: string[];
  minimum_match_score: number | null;
  is_active: boolean;
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobAlertMatch {
  id: string;
  alert_id: string;
  internship_source_url: string;
  match_score: number;
  matched_reasons: string[];
  detected_at: string;
  created_at: string;
}

export interface JobAlertMatchResult {
  id: string;
  alert_id: string;
  internship_source_url: string;
  match_score: number;
  matched_reasons: string[];
  detected_at: string;
  alert_name: string;
  internship: Internship;
}

export interface UserInternship {
  id: string;
  user_id: string;
  internship_id: string;
  application_status: ApplicationStatus;
  notes: string | null;
  created_at: string;
  application_deadline: string | null;
  follow_up_date: string | null;
  company?: string | null;
  role?: string | null;
  application_url?: string | null;
  source_url?: string | null;
}

export interface Internship {
  id: string;
  internshipId?: string;
  company: string | null;
  role: string | null;
  description: string | null;
  location: string | null;
  workMode: WorkMode | null;
  postedDate: string | null;
  deadline: string | null;
  duration: string | null;
  stipend: string | null;
  experienceRequired: string | null;
  graduationRequirements: string | null;
  requiredSkills: string[] | null;
  applicationUrl: string | null;
  sourceUrl: string | null;
  sourceDomain: string | null;
  status: InternshipStatus;
  lastVerifiedAt: string | null;
  createdAt: string;
  verificationStatus?: VerificationStatus | null;
  verificationScore?: number | null;
}

export type EligibilityStatus =
  | "eligible"
  | "possibly_eligible"
  | "not_eligible";

export interface EligibilityResult {
  status: EligibilityStatus;
  reasons: string[];
}

export interface MatchResult {
  /** A transparent match score in the inclusive range from 0 to 100. */
  score: number;
  reasons: string[];
}

export type VerificationStatus =
  | "verified"
  | "likely_legitimate"
  | "needs_review"
  | "suspicious";

export interface VerificationResult {
  status: VerificationStatus;
  score: number;
  reasons: string[];
}

export interface InternshipResult {
  internship: Internship;
  eligibility: EligibilityResult;
  match: MatchResult;
  verification: VerificationResult;
}

export interface SearchApiResponse {
  message: string;
  verificationResults: InternshipResult[];
  results?: SearchOpportunity[];
  error?: string;
}

export interface SearchOpportunity {
  url: string;
  title?: string | null;
  description?: string | null;
  sourcePriority?: number;
}

export type ResumeRecommendation = "strong_apply" | "apply" | "stretch" | "not_recommended";

export interface ResumeMatchResult {
  matchScore: number;
  matchingSkills: string[];
  missingSkills: string[];
  matchingKeywords: string[];
  missingKeywords: string[];
  relevantExperience: string[];
  eligibilityConcerns: string[];
  recommendation: ResumeRecommendation;
  summary: string;
  suggestions: string[];
}

export interface InternshipInsert {
  company: string | null;
  role: string | null;
  description: string | null;
  location: string | null;
  workMode: WorkMode | null;
  postedDate: string | null;
  deadline: string | null;
  duration: string | null;
  stipend: string | null;
  experienceRequired: string | null;
  graduationRequirements: string | null;
  requiredSkills: string[];
  applicationUrl: string | null;
  sourceUrl: string;
  sourceDomain: string | null;
  status?: InternshipStatus;
  verificationStatus: VerificationStatus | null;
  verificationScore: number | null;
  verificationReasons: string[];
  lastVerifiedAt: string | null;
}

export interface InternshipSearchItem {
  internship: Internship;
  eligibility: EligibilityResult;
  match: MatchResult;
}

export interface SearchResult {
  internships: InternshipSearchItem[];
  totalFound: number;
}
