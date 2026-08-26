"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Internship, JobAlertMatchResult, WorkMode } from "@/types/internship";
import AuthNav from "@/components/AuthNav";

type RawMatch = {
  id: string;
  alert_id: string;
  internship_source_url: string;
  match_score: number;
  matched_reasons: unknown;
  detected_at: string;
  job_alerts: { name: string } | { name: string }[] | null;
};

type RawInternship = {
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
  source_url: string | null;
  source_domain: string | null;
  status: "active" | "closed" | "expired";
  last_verified_at: string | null;
  created_at: string;
  verification_status: Internship["verificationStatus"];
  verification_score: number | null;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleString();
}

export default function JobAlertMatchesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [matches, setMatches] = useState<JobAlertMatchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadMatches() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        setMessage("Please sign in to view your job alert matches.");
        setLoading(false);
        return;
      }
      const { data: rawMatches, error: matchError } = await supabase
        .from("job_alert_matches")
        .select("id, alert_id, internship_source_url, match_score, matched_reasons, detected_at, job_alerts(name)")
        .order("detected_at", { ascending: false });
      if (cancelled) return;
      if (matchError) {
        setError("Unable to load your job alert matches.");
        setLoading(false);
        return;
      }
      const typedMatches = (rawMatches ?? []) as RawMatch[];
      const sourceUrls = [...new Set(typedMatches.map((match) => match.internship_source_url))];
      const { data: rawInternships, error: internshipError } = sourceUrls.length
        ? await supabase.from("internships").select("id, company, role, description, location, work_mode, posted_date, deadline, duration, stipend, experience_required, graduation_requirements, required_skills, application_url, source_url, source_domain, status, last_verified_at, created_at, verification_status, verification_score").in("source_url", sourceUrls)
        : { data: [], error: null };
      if (cancelled) return;
      if (internshipError) {
        setError("Unable to load internship details for your matches.");
        setLoading(false);
        return;
      }
      const internshipByUrl = new Map(((rawInternships ?? []) as RawInternship[]).map((internship) => [internship.source_url, internship]));
      const result = typedMatches.flatMap((match): JobAlertMatchResult[] => {
        const rawInternship = internshipByUrl.get(match.internship_source_url);
        if (!rawInternship) return [];
        const internship: Internship = {
          id: rawInternship.id,
          company: rawInternship.company,
          role: rawInternship.role,
          description: rawInternship.description,
          location: rawInternship.location,
          workMode: rawInternship.work_mode,
          postedDate: rawInternship.posted_date,
          deadline: rawInternship.deadline,
          duration: rawInternship.duration,
          stipend: rawInternship.stipend,
          experienceRequired: rawInternship.experience_required,
          graduationRequirements: rawInternship.graduation_requirements,
          requiredSkills: stringArray(rawInternship.required_skills),
          applicationUrl: rawInternship.application_url,
          sourceUrl: rawInternship.source_url,
          sourceDomain: rawInternship.source_domain,
          status: rawInternship.status,
          lastVerifiedAt: rawInternship.last_verified_at,
          createdAt: rawInternship.created_at,
          verificationStatus: rawInternship.verification_status,
          verificationScore: rawInternship.verification_score,
        };
        const alert = Array.isArray(match.job_alerts) ? match.job_alerts[0] : match.job_alerts;
        return [{ id: match.id, alert_id: match.alert_id, internship_source_url: match.internship_source_url, match_score: match.match_score, matched_reasons: stringArray(match.matched_reasons).slice(0, 3), detected_at: match.detected_at, alert_name: alert?.name ?? "Job alert", internship }];
      });
      setMatches(result);
      setMessage(result.length === 0 ? "Your active alerts will be checked automatically. New matching internships will appear here. Alert matching currently checks internships already stored in InternScout's database." : "");
      setLoading(false);
    }
    void loadMatches();
    return () => { cancelled = true; };
  }, [supabase]);

  if (loading) return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-300">Loading job alert matches...</main>;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between"><div><p className="text-sm font-medium text-blue-400">InternScout AI</p><h1 className="mt-1 text-3xl font-bold">Job Alert Matches</h1></div><div className="flex items-center gap-4"><nav className="flex flex-wrap gap-4 text-sm text-slate-300"><a href="/dashboard" className="hover:text-white">Dashboard</a><a href="/" className="hover:text-white">Home</a><a href="/tracker" className="hover:text-white">Tracker</a><a href="/preferences" className="hover:text-white">Preferences</a><a href="/alerts" className="hover:text-white">Alerts</a></nav><AuthNav /></div></header>
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        {message && <div className="mb-5 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">{message}</div>}
        <div className="space-y-5">{matches.map((match) => { const internship = match.internship; const applicationUrl = internship.applicationUrl || internship.sourceUrl; return <article key={match.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><p className="text-sm text-blue-400">{internship.company || "Company not specified"}</p><h2 className="mt-1 text-2xl font-semibold">{internship.role || "Internship opportunity"}</h2><p className="mt-2 text-sm text-slate-400">Matched by: {match.alert_name}</p></div><div className="rounded-xl border border-blue-400/30 bg-blue-400/10 px-4 py-3 text-center"><p className="text-2xl font-bold text-blue-300">{match.match_score}%</p><p className="text-xs text-blue-200">Match score</p></div></div><p className="mt-3 text-xs text-slate-500">Detected {formatDate(match.detected_at)}</p><p className="mt-3 text-sm text-slate-300">{internship.location || "Location not specified"}{internship.workMode ? ` · ${internship.workMode}` : ""}</p>{internship.requiredSkills && internship.requiredSkills.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{internship.requiredSkills.map((skill) => <span key={skill} className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs text-slate-200">{skill}</span>)}</div>}{(internship.stipend || internship.duration) && <p className="mt-4 text-sm text-slate-300">{internship.stipend && `Stipend: ${internship.stipend}`}{internship.stipend && internship.duration && " · "}{internship.duration && `Duration: ${internship.duration}`}</p>}<ul className="mt-4 space-y-1 text-sm text-slate-400">{match.matched_reasons.map((reason) => <li key={reason}>• {reason}</li>)}</ul><div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">{internship.verificationStatus && <span>Verification: {internship.verificationStatus}</span>}{internship.verificationScore !== null && internship.verificationScore !== undefined && <span>Confidence: {internship.verificationScore}/100</span>}{internship.status !== "active" && <span className="text-amber-300">This internship is no longer active.</span>}</div><div className="mt-6 flex justify-end">{applicationUrl ? <a href={applicationUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-blue-500 px-5 py-2.5 text-sm font-semibold hover:bg-blue-600">View Job / Apply Now</a> : <button type="button" disabled className="cursor-not-allowed rounded-lg bg-slate-700 px-5 py-2.5 text-sm text-slate-400">View Job / Apply Now</button>}</div></article>; })}</div>
      </div>
    </main>
  );
}
