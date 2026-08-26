"use client";

import { useEffect, useMemo, useState } from "react";
import AuthNav from "@/components/AuthNav";
import { createClient } from "@/lib/supabase/client";
import type { SearchFilters } from "@/types/internship";

type HistoryRow = { id: string; search_filters: SearchFilters; created_at: string };

function summary(filters: SearchFilters): string[] {
  return [
    filters.role,
    filters.workMode ? filters.workMode.charAt(0).toUpperCase() + filters.workMode.slice(1) : null,
    filters.location,
    filters.skills?.length ? filters.skills.join(", ") : null,
    `Posted within ${filters.postedWithinDays} days`,
    filters.paidOnly ? "Paid internships only" : null,
  ].filter((value): value is string => Boolean(value));
}

export default function SearchHistoryPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!authData.user) { setMessage("Please sign in to view your search history."); setLoading(false); return; }
      setUserId(authData.user.id);
      const { data, error: queryError } = await supabase.from("search_history").select("id, search_filters, created_at").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(50);
      if (cancelled) return;
      if (queryError) setError("Unable to load search history. Apply the search history database migration first.");
      setItems((data ?? []) as HistoryRow[]);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [supabase]);

  async function remove(id: string) {
    if (!userId) return;
    const { error: deleteError } = await supabase.from("search_history").delete().eq("id", id).eq("user_id", userId);
    if (deleteError) { setError("Unable to delete this search."); return; }
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function clearAll() {
    if (!userId) return;
    const { error: deleteError } = await supabase.from("search_history").delete().eq("user_id", userId);
    if (deleteError) { setError("Unable to clear search history."); return; }
    setItems([]);
  }

  function rerun(filters: SearchFilters) {
    window.localStorage.setItem("internscout:search-filters", JSON.stringify(filters));
    window.location.href = "/";
  }

  if (loading) return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-300">Loading search history...</main>;
  if (!userId) return <main className="min-h-screen bg-slate-950 px-6 py-10 text-white"><div className="mx-auto max-w-3xl"><p className="mb-4 text-red-400">{message}</p><a href="/login" className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold">Sign In</a></div></main>;
  return <main className="min-h-screen bg-slate-950 px-6 py-10 text-white"><div className="mx-auto max-w-4xl"><header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="text-sm font-medium text-blue-400">InternScout AI</p><h1 className="mt-1 text-3xl font-bold">Search History</h1></div><div className="flex items-center gap-4"><nav className="flex flex-wrap gap-4 text-sm text-slate-300"><a href="/" className="hover:text-white">Search</a><a href="/dashboard" className="hover:text-white">Dashboard</a><a href="/recommendations" className="hover:text-white">Recommendations</a><a href="/tracker" className="hover:text-white">Tracker</a></nav><AuthNav /></div></header>{error && <p className="mb-4 text-sm text-red-400">{error}</p>}{items.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">No searches saved yet. Run an internship search to build your history.</div> : <><div className="mb-4 flex justify-end"><button type="button" onClick={() => void clearAll()} className="text-sm text-red-300 hover:text-red-200">Clear All History</button></div><div className="space-y-3">{items.map((item) => <article key={item.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap gap-2">{summary(item.search_filters).map((part) => <span key={part} className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-sm text-slate-200">{part}</span>)}</div><p className="mt-3 text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p></div><div className="flex gap-2"><button type="button" onClick={() => rerun(item.search_filters)} className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold hover:bg-blue-600">Re-run Search</button><button type="button" onClick={() => void remove(item.id)} className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-300">Delete</button></div></div></article>)}</div></>}</div></main>;
}
