"use client";

import { useEffect, useRef, useState } from "react";
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
  const touchedPreferenceFields = useRef(new Set<string>());

  function markPreferenceField(field: string): void {
    touchedPreferenceFields.current.add(field);
  }

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

      const { error } = await supabase.from("user_internships").upsert(
        {
          user_id: authData.user.id,
          internship_source_url: input.sourceUrl,
          company: input.company,
          role: input.role,
          application_url: input.applicationUrl,
          status: "saved",
        },
        {
          onConflict: "user_id,internship_source_url",
          ignoreDuplicates: true,
        }
      );

      if (error) {
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

      console.log("Search response:", data);

      if (!response.ok) {
        setSearchError(data.error || "Unable to prepare your search.");
        return;
      }

      setInternships(data.verificationResults);
      const analyzedUrls = new Set(
        data.verificationResults
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
    } catch {
      setSearchError("Unable to reach the search service. Please try again.");
    } finally {
      window.setTimeout(() => setIsLoading(false), 900);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* Navbar */}
      <nav className="flex items-center justify-between border-b border-slate-800 px-8 py-5">
        <h1 className="text-2xl font-bold">
          InternScout <span className="text-blue-400">AI</span>
        </h1>

        <div className="flex items-center gap-4">
          <a href="/tracker" className="text-sm text-slate-300 hover:text-white">
            Tracker
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
                  <div className="mb-5 flex items-center justify-between">
                    <h3 className="text-2xl font-semibold">
                      {internships.length} matching internship
                      {internships.length === 1 ? "" : "s"}
                    </h3>
                  </div>

                  <div className="space-y-5">
                    {internships.map((item, index) => {
                  const internship = item.internship;
                  const applyUrl =
                    internship.applicationUrl || internship.sourceUrl;
                  const requiredSkills = internship.requiredSkills ?? [];
                  const freshness = freshnessLabel(internship.lastVerifiedAt);

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

                      <div className="mt-6 flex flex-wrap justify-end gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            void saveInternship({
                              sourceUrl: internship.sourceUrl || "",
                              company: internship.company,
                              role: internship.role,
                              applicationUrl: internship.applicationUrl,
                            })
                          }
                          disabled={
                            !internship.sourceUrl ||
                            savingUrl === internship.sourceUrl
                          }
                          className="rounded-lg border border-blue-400/50 px-5 py-2.5 text-sm font-semibold text-blue-300 transition hover:bg-blue-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {internship.sourceUrl && savedUrls.has(internship.sourceUrl)
                            ? "Saved"
                            : savingUrl === internship.sourceUrl
                              ? "Saving..."
                              : "Save"}
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
                  </div>
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
                            disabled={
                              savingUrl === opportunity.url
                            }
                            className="rounded-lg border border-blue-400/50 px-5 py-2.5 text-sm font-semibold text-blue-300 transition hover:bg-blue-400/10 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savedUrls.has(opportunity.url)
                              ? "Saved"
                              : savingUrl === opportunity.url
                                ? "Saving..."
                                : "Save"}
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
