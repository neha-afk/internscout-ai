"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AuthNav from "@/components/AuthNav";
import type {
  InternshipResult,
  ExperienceLevel,
  SearchApiResponse,
  SearchFilters,
  SearchOpportunity,
} from "@/types/internship";

type FormErrors = {
  role?: string;
  graduationYear?: string;
  minStipend?: string;
};

const SEARCH_RESULTS_STORAGE_KEY = "internscout:latest-search-results";

function isStoredSearchPayload(value: unknown): value is {
  message?: string;
  verificationResults: InternshipResult[];
  results?: SearchOpportunity[];
} {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.verificationResults)) return false;
  return payload.verificationResults.every((result) => {
    if (!result || typeof result !== "object") return false;
    const item = result as Record<string, unknown>;
    return (
      item.internship &&
      typeof item.internship === "object" &&
      item.eligibility &&
      typeof item.eligibility === "object" &&
      item.match &&
      typeof item.match === "object" &&
      item.verification &&
      typeof item.verification === "object"
    );
  });
}

function normalizeInternshipResult(result: InternshipResult): InternshipResult {
  const topLevel = result as InternshipResult & {
    id?: string | null;
    internshipId?: string | null;
  };
  const resolvedInternshipId =
    result.internship.internshipId ??
    result.internship.id ??
    topLevel.internshipId ??
    topLevel.id ??
    null;
  return {
    ...result,
    internship: {
      ...result.internship,
      id: resolvedInternshipId ?? "",
      internshipId: resolvedInternshipId ?? "",
    },
  };
}

function readableEligibility(
  status: InternshipResult["eligibility"]["status"]
): string {
  return status === "eligible"
    ? "Eligible"
    : status === "possibly_eligible"
      ? "Possibly Eligible"
      : "Not Eligible";
}

function readableVerification(
  status: InternshipResult["verification"]["status"]
): string {
  return status === "likely_legitimate"
    ? "Likely Legitimate"
    : status === "needs_review"
      ? "Needs Review"
      : status === "suspicious"
        ? "Suspicious"
        : "Verified";
}

function opportunityDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function freshnessLabel(timestamp: string | null): string | null {
  if (!timestamp) return null;
  const parsedTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp)) return null;
  const ageInDays = Math.max(
    0,
    Math.floor((Date.now() - parsedTimestamp) / (24 * 60 * 60 * 1000))
  );
  return ageInDays <= 3 ? "Fresh" : `Last verified ${ageInDays} days ago`;
}

function freshnessCategory(timestamp: string | null): "fresh" | "stale" | null {
  if (!timestamp) return null;
  const parsedTimestamp = Date.parse(timestamp);
  if (!Number.isFinite(parsedTimestamp)) return null;
  return Date.now() - parsedTimestamp <= 3 * 24 * 60 * 60 * 1000
    ? "fresh"
    : "stale";
}

function timestampValue(timestamp: string | null): number {
  if (!timestamp) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export default function Home() {
  const [role, setRole] = useState("");
  const [skills, setSkills] = useState("");
  const [location, setLocation] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [graduationYear, setGraduationYear] = useState("");
  const [experience, setExperience] = useState("");
  const [paidOnly, setPaidOnly] = useState(false);
  const [minStipend, setMinStipend] = useState("");
  const [postedWithin, setPostedWithin] = useState("7");
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [searchMessage, setSearchMessage] = useState("");
  const [searchError, setSearchError] = useState("");
  const [internships, setInternships] = useState<
    InternshipResult[] | null
  >(null);
  const [moreOpportunities, setMoreOpportunities] = useState<
    SearchOpportunity[]
  >([]);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [sortOption, setSortOption] = useState("best");
  const [modeFilter, setModeFilter] = useState("all");
  const [minimumScoreFilter, setMinimumScoreFilter] = useState("all");
  const [freshnessFilter, setFreshnessFilter] = useState("all");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const touchedPreferenceFields = useRef(new Set<string>());

  const availableWorkModes = useMemo(
    () =>
      [...new Set((internships ?? []).map((item) => item.internship.workMode).filter((mode): mode is "remote" | "hybrid" | "onsite" => mode !== null))],
    [internships]
  );
  const displayedInternships = useMemo(() => {
    const minimumScore = minimumScoreFilter === "all" ? 0 : Number(minimumScoreFilter);
    return [...(internships ?? [])]
      .filter((item) => modeFilter === "all" || item.internship.workMode === modeFilter)
      .filter((item) => item.match.score >= minimumScore)
      .filter((item) => freshnessFilter === "all" || freshnessCategory(item.internship.lastVerifiedAt) === freshnessFilter)
      .filter((item) => verificationFilter === "all" || item.verification.status === verificationFilter)
      .sort((left, right) => {
        if (sortOption === "newest") {
          return timestampValue(right.internship.lastVerifiedAt || right.internship.createdAt) - timestampValue(left.internship.lastVerifiedAt || left.internship.createdAt);
        }
        if (sortOption === "verification") return (right.verification.score ?? -1) - (left.verification.score ?? -1);
        return right.match.score - left.match.score;
      });
  }, [freshnessFilter, internships, minimumScoreFilter, modeFilter, sortOption, verificationFilter]);

  function resetResultFilters() {
    setSortOption("best");
    setModeFilter("all");
    setMinimumScoreFilter("all");
    setFreshnessFilter("all");
    setVerificationFilter("all");
  }

  function markPreferenceField(field: string): void {
    touchedPreferenceFields.current.add(field);
  }

  useEffect(() => {
    const stored = window.localStorage.getItem("internscout:search-filters");
    if (!stored) return;
    try {
      const filters = JSON.parse(stored) as Partial<SearchFilters>;
      if (typeof filters.role !== "string" || typeof filters.graduationYear !== "number" || typeof filters.postedWithinDays !== "number" || typeof filters.paidOnly !== "boolean") return;
      setRole(filters.role);
      setGraduationYear(String(filters.graduationYear));
      setPostedWithin(String(filters.postedWithinDays));
      setPaidOnly(filters.paidOnly);
      setSkills(Array.isArray(filters.skills) ? filters.skills.join(", ") : "");
      setLocation(filters.location ?? "");
      setWorkMode(filters.workMode ?? "");
      setExperience(filters.experience ?? "");
      setMinStipend(filters.minStipend === undefined ? "" : String(filters.minStipend));
      ["role", "graduationYear", "skills", "location", "workMode", "experience"].forEach((field) => touchedPreferenceFields.current.add(field));
      window.localStorage.removeItem("internscout:search-filters");
    } catch {
      window.localStorage.removeItem("internscout:search-filters");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function restoreResults() {
      const stored = window.sessionStorage.getItem(SEARCH_RESULTS_STORAGE_KEY);
      if (!stored) return;

      try {
        const parsed: unknown = JSON.parse(stored);
        if (!isStoredSearchPayload(parsed)) {
          window.sessionStorage.removeItem(SEARCH_RESULTS_STORAGE_KEY);
          return;
        }

        const normalizedResults = parsed.verificationResults.map(normalizeInternshipResult);
        const missingResults = normalizedResults
          .filter((result) => !result.internship.internshipId && result.internship.sourceUrl)
          .map((result) => result.internship);
        let repairedIds = new Map<string, string>();
        if (missingResults.length > 0) {
          try {
            const response = await fetch("/api/internships/lookup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ internships: missingResults }),
            });
            if (response.ok) {
              const data = (await response.json()) as {
                internships?: Array<{ sourceUrl?: unknown; internshipId?: unknown }>;
              };
              repairedIds = new Map(
                (data.internships ?? [])
                  .filter(
                    (item): item is { sourceUrl: string; internshipId: string; error?: string | null } =>
                      typeof item.sourceUrl === "string" &&
                      typeof item.internshipId === "string" &&
                      item.internshipId.length > 0
                  )
                  .map((item) => [item.sourceUrl, item.internshipId])
              );
            }
          } catch {
            // Keep results visible when the optional repair lookup is unavailable.
          }
        }
        const repairedResults = normalizedResults.map((result) => {
          const sourceUrl = result.internship.sourceUrl;
          const repairedId = sourceUrl ? repairedIds.get(sourceUrl) : undefined;
          return repairedId
            ? { ...result, internship: { ...result.internship, id: repairedId, internshipId: repairedId } }
            : result;
        });
        const normalizedResultsWithIds = repairedResults;
        if (cancelled) return;

        const analyzedUrls = new Set(
          normalizedResultsWithIds
            .map((item) => item.internship.sourceUrl)
            .filter((url): url is string => Boolean(url))
        );
        const seenUrls = new Set<string>();
        const remainingOpportunities = (parsed.results ?? []).filter((result) => {
          if (analyzedUrls.has(result.url) || seenUrls.has(result.url)) return false;
          seenUrls.add(result.url);
          return true;
        });

        setInternships(normalizedResultsWithIds);
        setMoreOpportunities(remainingOpportunities);
        if (parsed.message) setSearchMessage(parsed.message);
        try {
          window.sessionStorage.setItem(
            SEARCH_RESULTS_STORAGE_KEY,
            JSON.stringify({
              message: parsed.message,
              verificationResults: normalizedResultsWithIds,
              results: parsed.results ?? [],
            })
          );
        } catch {
          // Keep repaired results in React state if storage is unavailable.
        }
      } catch {
        window.sessionStorage.removeItem(SEARCH_RESULTS_STORAGE_KEY);
      }
    }

    void restoreResults();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled || !authData.user) return;

      const { data } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (cancelled || !data) return;

      if (!touchedPreferenceFields.current.has("role")) {
        setRole(data.preferred_roles?.[0] ?? "");
      }
      if (!touchedPreferenceFields.current.has("location")) {
        setLocation(data.preferred_locations?.[0] ?? "");
      }
      if (!touchedPreferenceFields.current.has("skills")) {
        setSkills(Array.isArray(data.skills) ? data.skills.join(", ") : "");
      }
      if (!touchedPreferenceFields.current.has("workMode")) {
        setWorkMode(data.preferred_work_modes?.[0] ?? "");
      }
      if (!touchedPreferenceFields.current.has("graduationYear")) {
        setGraduationYear(
          data.graduation_year === null || data.graduation_year === undefined
            ? ""
            : String(data.graduation_year)
        );
      }
      if (!touchedPreferenceFields.current.has("experience")) {
        const experienceMap: Record<ExperienceLevel, string> = {
          fresher: "0",
          beginner: "0-1",
          intermediate: "1-2",
          experienced: "2+",
        };
        setExperience(
          data.experience_level
            ? experienceMap[data.experience_level as ExperienceLevel] ?? ""
            : ""
        );
      }
    }

    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveInternship(input: {
    internshipId?: string | null;
    id?: string;
    sourceUrl: string;
    company: string | null;
    role: string | null;
    applicationUrl: string | null;
  }) {
    setSaveMessage("");
    setSavingUrl(input.sourceUrl);

    try {
      const supabase = createClient();
      const { data: authData, error: authError } =
        await supabase.auth.getUser();
      if (authError || !authData.user) {
        setSaveMessage("Please sign in to save internships.");
        return;
      }

      const resolvedInternshipId = input.internshipId ?? input.id ?? null;
      const { data: internship, error: internshipError } = resolvedInternshipId
        ? { data: { id: resolvedInternshipId }, error: null }
        : await supabase
            .from("internships")
            .select("id")
            .eq("source_url", input.sourceUrl)
            .maybeSingle();
      if (internshipError || !internship) {
        setSaveMessage("This opportunity is not available to save yet.");
        return;
      }
      const { data: existingSave, error: existingError } = await supabase
        .from("saved_internships")
        .select("id")
        .eq("user_id", authData.user.id)
        .eq("internship_id", internship.id)
        .maybeSingle();
      if (existingError) {
        setSaveMessage("Unable to check saved internships right now.");
        return;
      }
      if (existingSave) {
        setSavedUrls((current) => new Set(current).add(input.sourceUrl));
        setSaveMessage("This internship is already saved.");
        return;
      }
      const { data: savedRow, error } = await supabase.from("saved_internships").insert({
        user_id: authData.user.id,
        internship_id: internship.id,
        application_status: "saved",
      }).select("id, user_id, internship_id, application_status, created_at").single();
      if (error) {
        const { data: duplicateSave } = await supabase
          .from("saved_internships")
          .select("id")
          .eq("user_id", authData.user.id)
          .eq("internship_id", internship.id)
          .maybeSingle();
        if (duplicateSave) {
          setSavedUrls((current) => new Set(current).add(input.sourceUrl));
          setSaveMessage("This internship is already saved.");
          return;
        }
        setSaveMessage("Unable to save this internship right now.");
        return;
      }

      setSavedUrls((current) => new Set(current).add(input.sourceUrl));
      setSaveMessage("Internship saved to your tracker.");
    } finally {
      setSavingUrl(null);
    }
  }

  async function handleSearch() {
    const nextErrors: FormErrors = {};
    const stipendAmount = minStipend === "" ? undefined : Number(minStipend);

    if (!role) {
      nextErrors.role = "Please select a role.";
    }

    if (!graduationYear) {
      nextErrors.graduationYear = "Please select your graduation year.";
    }

    if (stipendAmount !== undefined && stipendAmount < 0) {
      nextErrors.minStipend = "Minimum stipend cannot be negative.";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSearchMessage("");
    setSearchError("");
    setInternships(null);
    setMoreOpportunities([]);

    const normalizedSkills = skills
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean);

    const filters: SearchFilters = {
      role,
      graduationYear: Number(graduationYear),
      postedWithinDays: Number(postedWithin),
      paidOnly,
      ...(normalizedSkills.length > 0 && { skills: normalizedSkills }),
      ...(location.trim() && { location: location.trim() }),
      ...(workMode && {
        workMode: workMode as SearchFilters["workMode"],
      }),
      ...(experience && {
        experience: experience as SearchFilters["experience"],
      }),
      ...(stipendAmount !== undefined && { minStipend: stipendAmount }),
    };

    setIsLoading(true);

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(filters),
      });
      const data = (await response.json()) as SearchApiResponse;

      if (!response.ok) {
        setSearchError(data.error || "Unable to prepare your search.");
        return;
      }

      const normalizedVerificationResults = data.verificationResults.map(normalizeInternshipResult);
      setInternships(normalizedVerificationResults);
      const analyzedUrls = new Set(
        normalizedVerificationResults
          .map((item) => item.internship.sourceUrl)
          .filter((url): url is string => Boolean(url))
      );
      const seenOpportunityUrls = new Set<string>();
      const remainingOpportunities = (data.results ?? []).filter((result) => {
        if (
          analyzedUrls.has(result.url) ||
          seenOpportunityUrls.has(result.url)
        ) {
          return false;
        }
        seenOpportunityUrls.add(result.url);
        return true;
      });
      setMoreOpportunities(remainingOpportunities);
      setSearchMessage(data.message || "Search request completed.");
      try {
        window.sessionStorage.setItem(
          SEARCH_RESULTS_STORAGE_KEY,
          JSON.stringify({
            message: data.message || "Search request completed.",
            verificationResults: normalizedVerificationResults,
            results: data.results ?? [],
          })
        );
      } catch {
        // Storage may be unavailable or full; the in-memory results remain usable.
      }
      void saveSearchHistory(filters);
    } catch {
      setSearchError("Unable to reach the search service. Please try again.");
    } finally {
      window.setTimeout(() => setIsLoading(false), 900);
    }
  }

  async function saveSearchHistory(filters: SearchFilters): Promise<void> {
    const supabase = createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;
    const { data: latest } = await supabase.from("search_history").select("search_filters, created_at").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (latest && JSON.stringify(latest.search_filters) === JSON.stringify(filters) && Date.now() - Date.parse(latest.created_at) < 10 * 60 * 1000) return;
    await supabase.from("search_history").insert({ user_id: authData.user.id, search_filters: filters });
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Navbar */}
      <nav className="flex items-center justify-between border-b border-slate-800 px-8 py-5">
        <h1 className="text-2xl font-bold">
          InternScout <span className="text-blue-400">AI</span>
        </h1>

        <div className="flex items-center gap-4">
          <a href="/recommendations" className="text-sm text-slate-300 hover:text-white">
            Recommendations
          </a>
          <a href="/search-history" className="text-sm text-slate-300 hover:text-white">
            Search History
          </a>
          <a href="/tracker" className="text-sm text-slate-300 hover:text-white">
            Tracker
          </a>
          <a href="/dashboard" className="text-sm text-slate-300 hover:text-white">
            Dashboard
          </a>
          <a href="/preferences" className="text-sm text-slate-300 hover:text-white">
            Preferences
          </a>
          <a href="/alerts" className="text-sm text-slate-300 hover:text-white">
            Job Alerts
          </a>
          <a href="/alerts/matches" className="text-sm text-slate-300 hover:text-white">
            Alert Matches
          </a>
          <AuthNav />
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-16 text-center">
        <h2 className="text-5xl font-bold tracking-tight">
          Find internships that actually match you.
        </h2>

        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-400">
          Search the web for fresh tech internships and get personalized
          matches based on your skills, experience, graduation year, and
          preferences.
        </p>
      </section>

      {/* Search Filters */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <h3 className="mb-6 text-xl font-semibold">
            Find Your Internship
          </h3>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="sr-only" htmlFor="role">
                Role
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => {
                  markPreferenceField("role");
                  setRole(e.target.value);
                }}
                aria-invalid={Boolean(errors.role)}
                aria-describedby={errors.role ? "role-error" : undefined}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
              >
                <option value="">Select role</option>
                <option value="Software Engineering">
                  Software Engineering
                </option>
                <option value="Frontend Development">
                  Frontend Development
                </option>
                <option value="Backend Development">
                  Backend Development
                </option>
                <option value="Full Stack Development">
                  Full Stack Development
                </option>
                <option value="AI/ML">AI / ML</option>
                <option value="Data Science">Data Science</option>
              </select>
              {errors.role && (
                <p id="role-error" className="mt-1 text-sm text-red-400">
                  {errors.role}
                </p>
              )}
            </div>

            <input
              type="text"
              placeholder="Location (e.g. Bengaluru, India)"
              value={location}
              onChange={(e) => {
                markPreferenceField("location");
                setLocation(e.target.value);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
            />

            <input
              type="text"
              placeholder="Skills (e.g. React, Python, Machine Learning)"
              value={skills}
              onChange={(e) => {
                markPreferenceField("skills");
                setSkills(e.target.value);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
            />

            <select
              value={workMode}
              onChange={(e) => {
                markPreferenceField("workMode");
                setWorkMode(e.target.value);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
            >
              <option value="">Work mode</option>
              <option value="remote">Remote</option>
              <option value="hybrid">Hybrid</option>
              <option value="onsite">Onsite</option>
            </select>

            <div>
              <label className="sr-only" htmlFor="graduation-year">
                Graduation year
              </label>
              <select
                id="graduation-year"
                value={graduationYear}
                onChange={(e) => {
                  markPreferenceField("graduationYear");
                  setGraduationYear(e.target.value);
                }}
                aria-invalid={Boolean(errors.graduationYear)}
                aria-describedby={
                  errors.graduationYear ? "graduation-year-error" : undefined
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
              >
                <option value="">Graduation year</option>
                <option value="2027">2027</option>
                <option value="2028">2028</option>
                <option value="2029">2029</option>
                <option value="2030">2030</option>
              </select>
              {errors.graduationYear && (
                <p
                  id="graduation-year-error"
                  className="mt-1 text-sm text-red-400"
                >
                  {errors.graduationYear}
                </p>
              )}
            </div>

            <select
              value={experience}
              onChange={(e) => {
                markPreferenceField("experience");
                setExperience(e.target.value);
              }}
              className="rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
            >
              <option value="">Experience</option>
              <option value="0">0 years / Fresher</option>
              <option value="0-1">0–1 years</option>
              <option value="1-2">1–2 years</option>
              <option value="2+">2+ years</option>
            </select>

            <select
              value={postedWithin}
              onChange={(e) => setPostedWithin(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
            >
              <option value="1">Last 24 hours</option>
              <option value="3">Last 3 days</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>

            <div>
              <label
                className="mb-2 block text-sm font-medium text-slate-300"
                htmlFor="min-stipend"
              >
                Minimum stipend per month (INR)
              </label>
              <input
                id="min-stipend"
                type="number"
                min="0"
                step="1"
                placeholder="Optional"
                value={minStipend}
                onChange={(e) => setMinStipend(e.target.value)}
                aria-invalid={Boolean(errors.minStipend)}
                aria-describedby={
                  errors.minStipend ? "min-stipend-error" : undefined
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none"
              />
              {errors.minStipend && (
                <p id="min-stipend-error" className="mt-1 text-sm text-red-400">
                  {errors.minStipend}
                </p>
              )}
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={paidOnly}
                onChange={(e) => setPaidOnly(e.target.checked)}
                className="h-4 w-4 accent-blue-500"
              />
              Paid internships only
            </label>
          </div>

          <button
            className="mt-6 w-full rounded-lg bg-blue-500 py-3 font-semibold transition hover:bg-blue-600"
            onClick={handleSearch}
            disabled={isLoading}
          >
            {isLoading ? "Preparing Search..." : "Search Internships"}
          </button>

          {searchError && (
            <p className="mt-3 text-sm text-red-400">{searchError}</p>
          )}
          {searchMessage && (
            <p className="mt-3 text-sm text-green-400">{searchMessage}</p>
          )}
          {saveMessage && (
            <p className="mt-3 text-sm text-blue-300">{saveMessage}</p>
          )}
        </div>
      </section>

      {internships !== null && (
        <section className="mx-auto max-w-5xl px-6 pb-20">
          {internships.length === 0 && moreOpportunities.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-300">
              No matching internships found. Try adjusting your filters.
            </div>
          ) : (
            <>
              {internships.length > 0 && (
                <>
                  <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                    <div className="grid gap-3 md:grid-cols-5">
                      <label className="text-xs text-slate-400">Sort
                        <select value={sortOption} onChange={(event) => setSortOption(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-sm text-white">
                          <option value="best">Best Match</option>
                          <option value="newest">Newest</option>
                          <option value="verification">Highest Verification</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-400">Work mode
                        <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-sm text-white">
                          <option value="all">All</option>
                          {availableWorkModes.map((mode) => <option key={mode} value={mode}>{mode === "onsite" ? "On-site" : mode.charAt(0).toUpperCase() + mode.slice(1)}</option>)}
                        </select>
                      </label>
                      <label className="text-xs text-slate-400">Minimum match
                        <select value={minimumScoreFilter} onChange={(event) => setMinimumScoreFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-sm text-white">
                          <option value="all">All</option><option value="50">50+</option><option value="60">60+</option><option value="70">70+</option><option value="80">80+</option><option value="90">90+</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-400">Freshness
                        <select value={freshnessFilter} onChange={(event) => setFreshnessFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-sm text-white">
                          <option value="all">All</option><option value="fresh">Fresh</option><option value="stale">Stale</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-400">Verification
                        <select value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 p-2 text-sm text-white">
                          <option value="all">All</option><option value="verified">Verified</option><option value="needs_review">Needs Review</option>
                        </select>
                      </label>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
                      <span>Showing {displayedInternships.length} of {internships.length} analyzed opportunities</span>
                      <button type="button" onClick={resetResultFilters} className="text-blue-300 hover:text-blue-200">Reset Filters</button>
                    </div>
                  </div>
                  <div className="mb-5 flex items-center justify-between">
                    <h3 className="text-2xl font-semibold">
                      {displayedInternships.length} matching internship
                      {displayedInternships.length === 1 ? "" : "s"}
                    </h3>
                  </div>

                  {displayedInternships.length === 0 ? (
                    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-300">
                      <p>No opportunities match these filters.</p>
                      <button type="button" onClick={resetResultFilters} className="mt-3 text-blue-300 hover:text-blue-200">Reset Filters</button>
                    </div>
                  ) : <div className="space-y-5">
                    {displayedInternships.map((item, index) => {
                  const internship = item.internship;
                  const resolvedInternshipId =
                    internship.internshipId ?? internship.id ?? null;
                  const canSave = Boolean(resolvedInternshipId);
                  const isSaving =
                    savingUrl !== null && savingUrl === internship.sourceUrl;
                  const applyUrl =
                    internship.applicationUrl || internship.sourceUrl;
                  const requiredSkills = internship.requiredSkills ?? [];
                  const freshness = freshnessLabel(internship.lastVerifiedAt);
                  const whyReasons = [
                    ...item.match.reasons,
                    ...item.eligibility.reasons,
                  ].filter((reason, reasonIndex, reasons) => reasons.indexOf(reason) === reasonIndex).slice(0, 5);

                  return (
                    <article
                      key={
                        internship.sourceUrl ||
                        `${internship.company || "internship"}-${index}`
                      }
                      className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
                    >
                      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-blue-400">
                            {internship.company || "Company not specified"}
                          </p>
                          <h4 className="mt-1 text-2xl font-semibold text-white">
                            {internship.role || "Internship role"}
                          </h4>
                          <p className="mt-2 text-sm text-slate-400">
                            {internship.location || "Location not specified"}
                            {internship.workMode && (
                              <span>
                                {" · "}
                                {internship.workMode === "onsite"
                                  ? "On-site"
                                  : internship.workMode.charAt(0).toUpperCase() +
                                    internship.workMode.slice(1)}
                              </span>
                            )}
                          </p>
                        </div>

                        <div className="shrink-0 rounded-xl border border-blue-400/30 bg-blue-400/10 px-4 py-3 text-center">
                          <p className="text-2xl font-bold text-blue-300">
                            {item.match.score}%
                          </p>
                          <p className="text-xs font-medium text-blue-200">
                            Match
                          </p>
                        </div>
                      </div>

                      {requiredSkills.length > 0 && (
                        <div className="mt-5 flex flex-wrap gap-2">
                          {requiredSkills.slice(0, 6).map((skill) => (
                            <span
                              key={skill}
                              className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200"
                            >
                              {skill}
                            </span>
                          ))}
                        </div>
                      )}

                      {(internship.stipend ||
                        internship.duration ||
                        internship.experienceRequired) && (
                        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-300">
                          {internship.stipend && (
                            <span>Stipend: {internship.stipend}</span>
                          )}
                          {internship.duration && (
                            <span>Duration: {internship.duration}</span>
                          )}
                          {internship.experienceRequired && (
                            <span>
                              Experience: {internship.experienceRequired}
                            </span>
                          )}
                        </div>
                      )}

                      {freshness && (
                        <p className="mt-4 text-xs text-emerald-300">
                          {freshness}
                        </p>
                      )}

                      <div className="mt-5 grid gap-4 border-t border-slate-800 pt-5 md:grid-cols-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-200">
                              {readableEligibility(item.eligibility.status)}
                            </span>
                            <span className="rounded-full border border-slate-700 px-2 py-1 text-xs text-slate-300">
                              Eligibility
                            </span>
                          </div>
                          <ul className="mt-2 space-y-1 text-sm text-slate-400">
                            {item.match.reasons.slice(0, 3).map((reason) => (
                              <li key={reason}>• {reason}</li>
                            ))}
                          </ul>
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-200">
                              {readableVerification(item.verification.status)}
                            </span>
                            <span className="text-xs text-slate-400">
                              {item.verification.score}/100 confidence
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            Assessment based on available posting signals.
                          </p>
                          <ul className="mt-2 space-y-1 text-sm text-slate-400">
                            {item.verification.reasons
                              .slice(0, 2)
                              .map((reason) => (
                                <li key={reason}>• {reason}</li>
                              ))}
                          </ul>
                        </div>
                      </div>

                      {whyReasons.length > 0 && (
                        <details className="mt-5 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                          <summary className="cursor-pointer text-sm font-semibold text-slate-200">Why this matches you</summary>
                          <ul className="mt-2 space-y-1 text-sm text-slate-400">
                            {whyReasons.map((reason) => <li key={reason}>• {reason}</li>)}
                          </ul>
                        </details>
                      )}

                      <div className="mt-6 flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            void saveInternship({
                              internshipId: resolvedInternshipId,
                              id: internship.id,
                              sourceUrl: internship.sourceUrl || "",
                              company: internship.company,
                              role: internship.role,
                              applicationUrl: internship.applicationUrl,
                            })
                          }
                          disabled={
                            !canSave || isSaving
                          }
                          className="rounded-lg border border-blue-400/50 px-5 py-2.5 text-sm font-semibold text-blue-300 transition hover:bg-blue-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {internship.sourceUrl && savedUrls.has(internship.sourceUrl)
                            ? "Saved"
                            : savingUrl === internship.sourceUrl
                              ? "Saving..."
                              : canSave
                                ? "Save"
                                : "Save unavailable"}
                        </button>
                        {applyUrl ? (
                          <a
                            href={applyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-600"
                          >
                            Apply Now
                          </a>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="cursor-not-allowed rounded-lg bg-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-400"
                          >
                            Apply Now
                          </button>
                        )}
                      </div>
                    </article>
                  );
                    })}
                  </div>}
                </>
              )}

              {moreOpportunities.length > 0 && (
                <div className={internships.length > 0 ? "mt-12" : ""}>
                  <h3 className="text-2xl font-semibold">
                    More Opportunities
                  </h3>
                  <p className="mt-2 text-sm text-slate-400">
                    These additional relevant opportunities were discovered during
                    the search but have not been fully analyzed yet.
                  </p>
                  <div className="mt-5 space-y-4">
                    {moreOpportunities.map((opportunity) => (
                      <article
                        key={opportunity.url}
                        className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
                      >
                        <p className="text-xs font-medium uppercase tracking-wide text-amber-300">
                          Not fully analyzed yet
                        </p>
                        <h4 className="mt-2 text-xl font-semibold text-white">
                          {opportunity.title || "Internship opportunity"}
                        </h4>
                        <p className="mt-1 text-sm text-slate-400">
                          {opportunityDomain(opportunity.url)}
                        </p>
                        {opportunity.description && (
                          <p className="mt-4 text-sm leading-6 text-slate-300">
                            {opportunity.description}
                          </p>
                        )}
                        <div className="mt-5 flex flex-wrap justify-end gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              void saveInternship({
                              sourceUrl: opportunity.url,
                                company: null,
                                role: opportunity.title ?? null,
                                applicationUrl: opportunity.url,
                              })
                            }
                            disabled
                            className="rounded-lg border border-blue-400/50 px-5 py-2.5 text-sm font-semibold text-blue-300 transition hover:bg-blue-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savedUrls.has(opportunity.url)
                              ? "Saved"
                              : "Save unavailable"}
                          </button>
                          <a
                            href={opportunity.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-blue-400/50 px-5 py-2.5 text-sm font-semibold text-blue-300 transition hover:bg-blue-400/10"
                          >
                            View Opportunity
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}
