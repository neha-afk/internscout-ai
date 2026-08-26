"use client";

import { useEffect, useMemo, useState } from "react";
import AuthNav from "@/components/AuthNav";
import { createClient } from "@/lib/supabase/client";
import { getInternshipRecommendations, type InternshipRecommendation, type RecommendationInternship, type RecommendationPreferences } from "@/lib/recommendations";
import type { UserPreferences } from "@/types/internship";

function freshness(item: RecommendationInternship): string {
  const value = item.last_verified_at ?? item.created_at;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Freshness unavailable";
  const days = Math.max(0, Math.floor((Date.now() - parsed) / (24 * 60 * 60 * 1000)));
  return days === 0 ? "Verified today" : `Verified ${days} day${days === 1 ? "" : "s"} ago`;
}

export default function RecommendationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [recommendations, setRecommendations] = useState<InternshipRecommendation[]>([]);
  const [hasPreferences, setHasPreferences] = useState(false);
  const [minimumScore, setMinimumScore] = useState(0);
  const [sortOption, setSortOption] = useState<"best" | "newest">("best");
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        setError("Please sign in to view personalized recommendations.");
        setLoading(false);
        return;
      }
      setEmail(authData.user.email ?? "");
      const [preferencesQuery, savedQuery] = await Promise.all([
        supabase.from("user_preferences").select("preferred_roles, preferred_work_modes, preferred_locations, skills, graduation_year, experience_level").eq("user_id", authData.user.id).maybeSingle(),
        supabase.from("saved_internships").select("internship_id").eq("user_id", authData.user.id),
      ]);
      if (cancelled) return;
      if (preferencesQuery.error || savedQuery.error) {
        setError("Unable to load your recommendations right now.");
        setLoading(false);
        return;
      }
      const preferences = preferencesQuery.data as UserPreferences | null;
      setHasPreferences(Boolean(preferences));
      if (!preferences) {
        setLoading(false);
        return;
      }
      const { data: internshipRows, error: internshipsError } = await supabase
        .from("internships")
        .select("id, company, role, location, work_mode, required_skills, status, last_verified_at, created_at, posted_date, source_url, application_url")
        .eq("status", "active")
        .order("last_verified_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (cancelled) return;
      if (internshipsError) {
        setError("Unable to load available internships right now.");
        setLoading(false);
        return;
      }
      const recommendationPreferences: RecommendationPreferences = {
        preferred_roles: preferences.preferred_roles ?? [],
        preferred_work_modes: preferences.preferred_work_modes ?? [],
        preferred_locations: preferences.preferred_locations ?? [],
        skills: preferences.skills ?? [],
        graduation_year: preferences.graduation_year,
        experience_level: preferences.experience_level,
      };
      const rows = (internshipRows ?? []) as RecommendationInternship[];
      const savedIds = new Set(((savedQuery.data ?? []) as { internship_id: string }[]).map((item) => item.internship_id));
      setRecommendations(getInternshipRecommendations(rows, recommendationPreferences, savedIds));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [supabase]);

  const displayedRecommendations = useMemo(() => {
    const filtered = recommendations.filter((item) => item.score >= minimumScore);
    return [...filtered].sort((left, right) => {
      if (sortOption === "newest") return Date.parse(right.internship.posted_date ?? right.internship.created_at) - Date.parse(left.internship.posted_date ?? left.internship.created_at);
      return right.score - left.score;
    });
  }, [minimumScore, recommendations, sortOption]);

  async function saveRecommendation(recommendation: InternshipRecommendation) {
    setSavingId(recommendation.internship.id);
    setSaveMessage("");
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setSaveMessage("Please sign in to save internships.");
      setSavingId(null);
      return;
    }
    const { data: existing } = await supabase.from("saved_internships").select("id").eq("user_id", authData.user.id).eq("internship_id", recommendation.internship.id).maybeSingle();
    if (existing) {
      setRecommendations((current) => current.filter((item) => item.internship.id !== recommendation.internship.id));
      setSaveMessage("This internship is already saved.");
      setSavingId(null);
      return;
    }
    const { data: savedRow, error: insertError } = await supabase.from("saved_internships").insert({ user_id: authData.user.id, internship_id: recommendation.internship.id, application_status: "saved" }).select("id, user_id, internship_id, application_status, created_at").single();
    if (insertError) {
      setSaveMessage("Unable to save this internship right now.");
      setSavingId(null);
      return;
    }
    setRecommendations((current) => current.filter((item) => item.internship.id !== recommendation.internship.id));
    setSaveMessage("Internship saved to your tracker.");
    setSavingId(null);
  }

  if (loading) return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-300">Loading recommendations...</main>;
  if (error && !email) return <main className="min-h-screen bg-slate-950 px-6 py-10 text-white"><div className="mx-auto max-w-5xl"><p className="mb-4 text-red-400">{error}</p><a href="/login" className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold">Sign In</a></div></main>;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-medium text-blue-400">InternScout AI</p><h1 className="mt-1 text-3xl font-bold">Recommended for You</h1><p className="mt-1 text-sm text-slate-400">{email}</p></div><div className="flex items-center gap-4"><nav className="flex flex-wrap gap-4 text-sm text-slate-300"><a href="/" className="hover:text-white">Search</a><a href="/dashboard" className="hover:text-white">Dashboard</a><a href="/tracker" className="hover:text-white">Tracker</a><a href="/preferences" className="hover:text-white">Preferences</a><a href="/alerts" className="hover:text-white">Alerts</a></nav><AuthNav /></div></header>
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        {saveMessage && <p className="mb-4 text-sm text-green-400">{saveMessage}</p>}
        {!hasPreferences ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">Complete your preferences to get personalized internship recommendations. <a href="/preferences" className="text-blue-300 hover:text-blue-200">Update Preferences</a></div> : (
          <>
            <div className="mb-6 flex flex-wrap items-end gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4"><label className="text-sm text-slate-300">Sort<select value={sortOption} onChange={(event) => setSortOption(event.target.value as typeof sortOption)} className="ml-2 rounded-lg border border-slate-700 bg-slate-800 p-2 text-white"><option value="best">Best Match</option><option value="newest">Newest</option></select></label><label className="text-sm text-slate-300">Minimum match score<input type="number" min="0" max="100" value={minimumScore} onChange={(event) => setMinimumScore(Math.max(0, Math.min(100, Number(event.target.value) || 0)))} className="ml-2 w-24 rounded-lg border border-slate-700 bg-slate-800 p-2 text-white" /></label></div>
            {displayedRecommendations.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">No recommendations match your preferences and filters yet. <a href="/" className="text-blue-300 hover:text-blue-200">Search internships</a></div> : <div className="space-y-4">{displayedRecommendations.map((recommendation) => { const item = recommendation.internship; return <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><p className="text-sm text-blue-400">{item.company || "Company not specified"}</p><h2 className="mt-1 text-xl font-semibold">{item.role || "Internship opportunity"}</h2><p className="mt-1 text-sm text-slate-400">{item.location || "Location unavailable"}{item.work_mode ? ` · ${item.work_mode}` : ""}</p><p className="mt-2 text-xs text-slate-500">{freshness(item)}</p><p className="mt-2 text-sm text-slate-300"><span className="font-semibold">Why recommended:</span> {recommendation.reasons.length ? recommendation.reasons.join(" · ") : "Strong overall profile match"}</p></div><div className="flex flex-wrap items-start gap-2"><span className="rounded-lg bg-blue-400/10 px-3 py-2 text-lg font-bold text-blue-300">{recommendation.score}%</span><button type="button" onClick={() => void saveRecommendation(recommendation)} disabled={savingId === item.id} className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold hover:bg-blue-600 disabled:opacity-60">{savingId === item.id ? "Saving..." : "Save Job"}</button></div></div>{(item.application_url || item.source_url) && <a href={item.application_url || item.source_url || "#"} target="_blank" rel="noopener noreferrer" className="mt-4 inline-block text-sm text-blue-300 hover:text-blue-200">View opportunity</a>}</article>; })}</div>}
          </>
        )}
      </div>
    </main>
  );
}
