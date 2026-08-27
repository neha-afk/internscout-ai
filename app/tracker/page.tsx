"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ApplicationStatus, UserInternship } from "@/types/internship";
import AuthNav from "@/components/AuthNav";

const statuses: ApplicationStatus[] = [
  "saved",
  "applied",
  "assessment",
  "interview",
  "offer",
  "rejected",
];

const statusLabels: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

function daysFromToday(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function dateStatus(value: string | null, label: string): string | null {
  if (!value) return null;
  const days = daysFromToday(value);
  if (days === 0) return `${label}: Today`;
  if (days > 0) return `${label} in ${days} days`;
  return label === "Deadline" ? "Deadline passed" : "Follow-up overdue";
}

export default function TrackerPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [items, setItems] = useState<UserInternship[]>([]);
  const [message, setMessage] = useState("Loading your tracker...");
  const [error, setError] = useState("");
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let cancelled = false;

    async function loadTracker() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        setMessage("Please sign in to view your application tracker.");
        return;
      }

      setUserId(authData.user.id);
      const { data, error: queryError } = await supabase
        .from("saved_internships")
        .select("id, user_id, internship_id, application_status, notes, created_at, application_deadline, follow_up_date")
        .eq("user_id", authData.user.id)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (queryError) {
        setError("Unable to load your saved internships.");
        setMessage("");
        return;
      }
      const savedRows = (data ?? []) as UserInternship[];
      const internshipIds = [...new Set(savedRows.map((item) => item.internship_id))];
      const { data: internshipRows } = internshipIds.length
        ? await supabase.from("internships").select("id, company, role, application_url, source_url").in("id", internshipIds)
        : { data: [] };
      const details = new Map(((internshipRows ?? []) as Array<{ id: string; company: string | null; role: string | null; application_url: string | null; source_url: string | null }>).map((internship) => [internship.id, internship]));
      const mappedItems = savedRows.map((item) => {
        const internship = details.get(item.internship_id);
        return { ...item, company: internship?.company ?? null, role: internship?.role ?? null, application_url: internship?.application_url ?? null, source_url: internship?.source_url ?? null };
      });
      setItems(mappedItems);
      setMessage(mappedItems.length ? "" : "No saved internships yet.");
    }

    void loadTracker();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function updateStatus(id: string, status: ApplicationStatus) {
    if (!userId) return;
    const { error: updateError } = await supabase
      .from("saved_internships")
      .update({ application_status: status })
      .eq("id", id)
      .eq("user_id", userId);
    if (updateError) {
      setError("Unable to update this application.");
      return;
    }
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, application_status: status } : item))
    );
  }

  async function updateDate(
    id: string,
    field: "application_deadline" | "follow_up_date",
    value: string
  ) {
    if (!userId) return;
    const { error: updateError } = await supabase
      .from("saved_internships")
      .update({ [field]: value || null })
      .eq("id", id)
      .eq("user_id", userId);
    if (updateError) {
      setError("Unable to update this date.");
      return;
    }
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, [field]: value || null } : item))
    );
  }

  async function removeItem(id: string) {
    if (!userId) return;
    const { error: deleteError } = await supabase
      .from("saved_internships")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (deleteError) {
      setError("Unable to remove this internship.");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-400">InternScout AI</p>
            <h1 className="mt-1 text-3xl font-bold">Application Tracker</h1>
          </div>
          <nav className="flex gap-4 text-sm text-slate-300">
            <a href="/dashboard" className="hover:text-white">Dashboard</a>
            <a href="/" className="hover:text-white">Home</a>
            <a href="/preferences" className="hover:text-white">Preferences</a>
            <a href="/recommendations" className="hover:text-white">Recommendations</a>
            <a href="/alerts" className="hover:text-white">Alerts</a>
            <a href="/alerts/matches" className="hover:text-white">Matches</a>
          </nav>
          <AuthNav />
        </div>

        {error && <p className="mb-5 text-sm text-red-400">{error}</p>}
        {message && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
            {message}
          </div>
        )}

        <div className="space-y-8">
          {statuses.map((status) => {
            const statusItems = items.filter((item) => item.application_status === status);
            if (statusItems.length === 0) return null;
            return (
              <section key={status}>
                <h2 className="mb-3 text-xl font-semibold">{statusLabels[status]}</h2>
                <div className="space-y-4">
                  {statusItems.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="text-sm text-blue-400">
                            {item.company || "Company not specified"}
                          </p>
                          <h3 className="mt-1 text-xl font-semibold">
                            {item.role || "Internship opportunity"}
                          </h3>
                          <a
                            href={item.application_url || item.source_url || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-sm text-blue-300 hover:text-blue-200"
                          >
                            View application
                          </a>
                          <a href={`/copilot?internshipId=${encodeURIComponent(item.internship_id)}`} className="ml-3 text-sm text-purple-300 hover:text-purple-200">
                            Application Copilot
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={item.application_status}
                            onChange={(event) =>
                              void updateStatus(
                                item.id,
                                event.target.value as ApplicationStatus
                              )
                            }
                            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
                          >
                            {statuses.map((option) => (
                              <option key={option} value={option}>
                                {statusLabels[option]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => void removeItem(item.id)}
                            className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-300 hover:bg-red-400/10"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 border-t border-slate-800 pt-5 md:grid-cols-2">
                        <label className="text-sm text-slate-300">Application deadline
                          <input type="date" value={item.application_deadline ?? ""} onChange={(event) => void updateDate(item.id, "application_deadline", event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 p-2" />
                          {dateStatus(item.application_deadline, "Deadline") && <span className={`mt-2 block text-xs ${item.application_deadline && daysFromToday(item.application_deadline) <= 3 ? "text-amber-300" : "text-slate-400"}`}>{dateStatus(item.application_deadline, "Deadline")}</span>}
                          {item.application_deadline && daysFromToday(item.application_deadline) <= 3 && <span className="mt-1 block text-xs font-semibold text-amber-300">{daysFromToday(item.application_deadline) < 0 ? "Deadline Passed" : "Closing Soon"}</span>}
                        </label>
                        <label className="text-sm text-slate-300">Follow-up date
                          <input type="date" value={item.follow_up_date ?? ""} onChange={(event) => void updateDate(item.id, "follow_up_date", event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 p-2" />
                          {dateStatus(item.follow_up_date, "Follow up") && <span className="mt-2 block text-xs text-slate-400">{dateStatus(item.follow_up_date, "Follow up")}</span>}
                        </label>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
