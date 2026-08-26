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

export interface UserInternship {
  id: string;
  user_id: string;
  internship_source_url: string;
  company: string | null;
  role: string | null;
  application_url: string | null;
  status: ApplicationStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Internship {
  id: string;
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
