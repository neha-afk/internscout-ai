"use client";

import { useEffect, useMemo, useState } from "react";
import AuthNav from "@/components/AuthNav";
import { createClient } from "@/lib/supabase/client";
import { getInternshipRecommendations, type InternshipRecommendation, type RecommendationInternship, type RecommendationPreferences } from "@/lib/recommendations";
import type { ApplicationStatus, UserPreferences, WorkMode } from "@/types/internship";

type RecentMatch = {
  id: string;
  match_score: number;
  detected_at: string;
  alert_name: string;
  source_url: string;
  company: string | null;
  role: string | null;
  location: string | null;
  work_mode: WorkMode | null;
};

type UpcomingItem = {
  id: string;
  company: string | null;
  role: string | null;
  date: string;
  type: "Application Deadline" | "Follow-up";
  days: number;
};

const progressStatuses: ApplicationStatus[] = [
  "saved",
  "applied",
  "assessment",
  "interview",
  "offer",
  "rejected",
];

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown date" : date.toLocaleDateString();
}

function daysFromToday(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function recommendationFreshness(timestamp: string | null, createdAt: string): string {
  const parsed = Date.parse(timestamp ?? createdAt);
  if (!Number.isFinite(parsed)) return "Freshness unavailable";
  const ageInDays = Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
  return ageInDays === 0 ? "Verified today" : `Verified ${ageInDays} day${ageInDays === 1 ? "" : "s"} ago`;
}

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [activeAlerts, setActiveAlerts] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);
  const [savedJobs, setSavedJobs] = useState(0);
  const [applications, setApplications] = useState(0);
  const [progress, setProgress] = useState<Record<ApplicationStatus, number>>({
    saved: 0,
    applied: 0,
    assessment: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
  });
  const [recentMatches, setRecentMatches] = useState<RecentMatch[]>([]);
  const [upcomingItems, setUpcomingItems] = useState<UpcomingItem[]>([]);
  const [overdueFollowUps, setOverdueFollowUps] = useState(0);
  const [recommendations, setRecommendations] = useState<InternshipRecommendation[]>([]);
  const [hasPreferences, setHasPreferences] = useState(false);
  const [recommendationsUnavailable, setRecommendationsUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadDashboard() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        setError("Please sign in to view your dashboard.");
        setLoading(false);
        return;
      }
      setEmail(authData.user.email ?? "");

      const [alertsQuery, matchesCountQuery, matchesQuery, savedQuery, preferencesQuery] = await Promise.all([
        supabase.from("job_alerts").select("id", { count: "exact", head: true }).eq("user_id", authData.user.id).eq("is_active", true),
        supabase.from("job_alert_matches").select("id", { count: "exact", head: true }),
        supabase.from("job_alert_matches").select("id, internship_source_url, match_score, detected_at, job_alerts(name)").order("detected_at", { ascending: false }).limit(5),
        supabase.from("saved_internships").select("id, internship_id, application_status, application_deadline, follow_up_date, created_at").eq("user_id", authData.user.id),
        supabase.from("user_preferences").select("preferred_roles, preferred_work_modes, preferred_locations, skills, graduation_year, experience_level").eq("user_id", authData.user.id).maybeSingle(),
      ]);
      if (cancelled) return;

      if (alertsQuery.error || matchesCountQuery.error || matchesQuery.error || savedQuery.error || preferencesQuery.error) {
        setError("Some dashboard information could not be loaded.");
      }
      setActiveAlerts(alertsQuery.count ?? 0);
      setTotalMatches(matchesCountQuery.count ?? 0);

      const nextProgress: Record<ApplicationStatus, number> = { saved: 0, applied: 0, assessment: 0, interview: 0, offer: 0, rejected: 0 };
      const savedRows = (savedQuery.data ?? []) as { id: string; internship_id: string; application_status: ApplicationStatus; application_deadline: string | null; follow_up_date: string | null; created_at: string }[];
      const savedInternshipIds = [...new Set(savedRows.map((item) => item.internship_id))];
      const savedDetailsQuery = savedInternshipIds.length
        ? await supabase.from("internships").select("id, company, role").in("id", savedInternshipIds)
        : { data: [], error: null };
      const savedDetails = new Map(((savedDetailsQuery.data ?? []) as { id: string; company: string | null; role: string | null }[]).map((item) => [item.id, item]));
      const trackedItems = savedRows.map((item) => ({ ...item, company: savedDetails.get(item.internship_id)?.company ?? null, role: savedDetails.get(item.internship_id)?.role ?? null }));
      for (const item of trackedItems) {
        if (item.application_status in nextProgress) nextProgress[item.application_status] += 1;
      }
      setProgress(nextProgress);
      setSavedJobs(trackedItems.length);
      setApplications(trackedItems.filter((item) => item.application_status !== "saved").length);
      const upcoming = trackedItems.flatMap((item) => [
        item.application_deadline ? { id: `${item.id}-deadline`, company: item.company, role: item.role, date: item.application_deadline, type: "Application Deadline" as const, days: daysFromToday(item.application_deadline) } : null,
        item.follow_up_date ? { id: `${item.id}-follow-up`, company: item.company, role: item.role, date: item.follow_up_date, type: "Follow-up" as const, days: daysFromToday(item.follow_up_date) } : null,
      ]).filter((item): item is UpcomingItem => item !== null && item.days >= 0).sort((left, right) => left.days - right.days).slice(0, 5);
      setUpcomingItems(upcoming);
      setOverdueFollowUps(trackedItems.filter((item) => item.follow_up_date !== null && daysFromToday(item.follow_up_date) < 0).length);

      const preferences = preferencesQuery.data as UserPreferences | null;
      setHasPreferences(Boolean(preferences));
      if (preferences && !preferencesQuery.error) {
        const internshipsQuery = await supabase
          .from("internships")
          .select("id, company, role, location, work_mode, required_skills, status, last_verified_at, created_at")
          .eq("status", "active")
          .order("last_verified_at", { ascending: false, nullsFirst: false })
          .limit(100);
        if (internshipsQuery.error) {
          setRecommendationsUnavailable(true);
        } else {
          const recommendationPreferences: RecommendationPreferences = {
            preferred_roles: preferences.preferred_roles ?? [],
            preferred_work_modes: preferences.preferred_work_modes ?? [],
            preferred_locations: preferences.preferred_locations ?? [],
            skills: preferences.skills ?? [],
            graduation_year: preferences.graduation_year,
            experience_level: preferences.experience_level,
          };
          const recommendationRows = (internshipsQuery.data ?? []) as RecommendationInternship[];
          setRecommendations(getInternshipRecommendations(recommendationRows, recommendationPreferences, new Set(trackedItems.map((item) => item.internship_id))));
        }
      } else if (preferencesQuery.error) {
        setRecommendationsUnavailable(true);
      }

      const rawMatches = (matchesQuery.data ?? []) as { id: string; internship_source_url: string; match_score: number; detected_at: string; job_alerts: { name: string } | { name: string }[] | null }[];
      const urls = [...new Set(rawMatches.map((item) => item.internship_source_url))];
      const internshipsQuery = urls.length ? await supabase.from("internships").select("source_url, company, role, location, work_mode").in("source_url", urls) : { data: [], error: null };
      const details = new Map(((internshipsQuery.data ?? []) as { source_url: string; company: string | null; role: string | null; location: string | null; work_mode: WorkMode | null }[]).map((item) => [item.source_url, item]));
      setRecentMatches(rawMatches.flatMap((match) => {
        const internship = details.get(match.internship_source_url);
        if (!internship) return [];
        const alert = Array.isArray(match.job_alerts) ? match.job_alerts[0] : match.job_alerts;
        return [{ id: match.id, match_score: match.match_score, detected_at: match.detected_at, alert_name: alert?.name ?? "Job alert", source_url: match.internship_source_url, company: internship.company, role: internship.role, location: internship.location, work_mode: internship.work_mode }];
      }));
      setLoading(false);
    }
    void loadDashboard();
    return () => { cancelled = true; };
  }, [supabase]);

  if (loading) return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-300">Loading your dashboard...</main>;
  if (error && !email) return <main className="min-h-screen bg-slate-950 px-6 py-10 text-white"><div className="mx-auto max-w-5xl"><p className="mb-4 text-red-400">{error}</p><a href="/login" className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold">Sign In</a></div></main>;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between"><div><p className="text-sm font-medium text-blue-400">InternScout AI</p><h1 className="mt-1 text-3xl font-bold">Welcome back</h1>{email && <p className="mt-1 text-sm text-slate-400">{email}</p>}</div><div className="flex items-center gap-4"><nav className="flex flex-wrap gap-4 text-sm text-slate-300"><a href="/" className="hover:text-white">Search</a><a href="/recommendations" className="hover:text-white">Recommendations</a><a href="/tracker" className="hover:text-white">Tracker</a><a href="/preferences" className="hover:text-white">Preferences</a><a href="/alerts" className="hover:text-white">Alerts</a><a href="/alerts/matches" className="hover:text-white">Matches</a></nav><AuthNav /></div></header>
        {error && <p className="mb-4 text-sm text-amber-300">{error}</p>}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[{ label: "New Job Matches", value: totalMatches, href: "/alerts/matches" }, { label: "Saved Jobs", value: savedJobs, href: "/tracker" }, { label: "Applications", value: applications, href: "/tracker" }, { label: "Active Job Alerts", value: activeAlerts, href: "/alerts" }].map((card) => <a key={card.label} href={card.href} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 transition hover:border-blue-400/50"><p className="text-sm text-slate-400">{card.label}</p><p className="mt-2 text-3xl font-bold text-blue-300">{card.value}</p></a>)}
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold">Recommended for You</h2>
          {!hasPreferences ? <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">Complete your preferences to get personalized internship recommendations. <a href="/preferences" className="text-blue-300 hover:text-blue-200">Update Preferences</a></div> : recommendationsUnavailable ? <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">Recommendations are temporarily unavailable. Try again later.</div> : recommendations.length === 0 ? <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">No strong recommendations yet. New opportunities are added regularly. <a href="/" className="text-blue-300 hover:text-blue-200">Search internships</a></div> : <div className="mt-4 space-y-3">{recommendations.slice(0, 5).map((recommendation) => <article key={recommendation.internship.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-sm text-blue-400">{recommendation.internship.company || "Company not specified"}</p><h3 className="text-lg font-semibold">{recommendation.internship.role || "Internship opportunity"}</h3><p className="mt-1 text-sm text-slate-400">{recommendation.internship.location || "Location unavailable"}{recommendation.internship.work_mode ? ` · ${recommendation.internship.work_mode}` : ""}</p><p className="mt-1 text-xs text-slate-500">{recommendationFreshness(recommendation.internship.last_verified_at, recommendation.internship.created_at)}</p>{recommendation.reasons.length > 0 && <p className="mt-2 text-sm text-slate-300">{recommendation.reasons.join(" · ")}</p>}</div><span className="rounded-lg bg-blue-400/10 px-3 py-2 text-lg font-bold text-blue-300">{recommendation.score}% match</span></div></article>)}</div>}
        </section>

        <section className="mt-10"><div className="flex items-center justify-between"><h2 className="text-2xl font-semibold">Recent Job Matches</h2><a href="/alerts/matches" className="text-sm text-blue-300 hover:text-blue-200">View all matches</a></div>{recentMatches.length === 0 ? <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">No detected matches yet. Active alerts will be checked automatically.</div> : <div className="mt-4 space-y-3">{recentMatches.map((match) => <article key={match.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-blue-400">{match.company || "Company not specified"}</p><h3 className="text-lg font-semibold">{match.role || "Internship opportunity"}</h3><p className="text-xs text-slate-500">{match.alert_name} · {formatDate(match.detected_at)}</p><p className="mt-1 text-sm text-slate-400">{match.location || "Location unavailable"}{match.work_mode ? ` · ${match.work_mode}` : ""}</p></div><span className="rounded-lg bg-blue-400/10 px-3 py-2 text-lg font-bold text-blue-300">{match.match_score}%</span></div></article>)}</div>}</section>

        <section className="mt-10"><div className="flex items-center justify-between"><h2 className="text-2xl font-semibold">Upcoming Deadlines</h2><a href="/tracker" className="text-sm text-blue-300 hover:text-blue-200">View tracker</a></div>{upcomingItems.length === 0 ? <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">No upcoming deadlines or follow-ups. Add dates from your Application Tracker.</div> : <div className="mt-4 space-y-3">{upcomingItems.map((item) => <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm text-blue-400">{item.company || "Company not specified"}</p><p className="font-semibold">{item.role || "Internship opportunity"}</p><p className="text-xs text-slate-500">{item.type} · {formatDate(item.date)}</p></div><span className="text-sm text-amber-300">{item.days === 0 ? "Today" : `In ${item.days} days`}</span></div></div>)}</div>}{overdueFollowUps > 0 && <p className="mt-3 text-sm text-amber-300">{overdueFollowUps} overdue follow-up{overdueFollowUps === 1 ? "" : "s"}</p>}</section>

        <section className="mt-10"><h2 className="text-2xl font-semibold">Application Progress</h2><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{progressStatuses.map((status) => <div key={status} className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="text-xs capitalize text-slate-400">{status}</p><p className="mt-1 text-2xl font-bold text-white">{progress[status]}</p></div>)}</div></section>

        <section className="mt-10"><h2 className="text-2xl font-semibold">Quick Actions</h2><div className="mt-4 flex flex-wrap gap-3"><a href="/" className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold">Search Internships</a><a href="/alerts" className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Create Job Alert</a><a href="/preferences" className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Update Preferences</a><a href="/tracker" className="rounded-lg border border-slate-700 px-4 py-2 text-sm">View Application Tracker</a></div></section>
      </div>
    </main>
  );
}
