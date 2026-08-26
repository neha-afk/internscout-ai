"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ApplicationStatus, UserInternship } from "@/types/internship";

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
        .from("user_internships")
        .select("*")
        .eq("user_id", authData.user.id)
        .order("updated_at", { ascending: false });

      if (cancelled) return;
      if (queryError) {
        setError("Unable to load your saved internships.");
        setMessage("");
        return;
      }
      setItems((data ?? []) as UserInternship[]);
      setMessage(data?.length ? "" : "No saved internships yet.");
    }

    void loadTracker();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function updateStatus(id: string, status: ApplicationStatus) {
    if (!userId) return;
    const { error: updateError } = await supabase
      .from("user_internships")
      .update({ status })
      .eq("id", id)
      .eq("user_id", userId);
    if (updateError) {
      setError("Unable to update this application.");
      return;
    }
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item))
    );
  }

  async function removeItem(id: string) {
    if (!userId) return;
    const { error: deleteError } = await supabase
      .from("user_internships")
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
          <a href="/" className="text-sm text-slate-300 hover:text-white">
            Back to search
          </a>
        </div>

        {error && <p className="mb-5 text-sm text-red-400">{error}</p>}
        {message && (
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">
            {message}
          </div>
        )}

        <div className="space-y-8">
          {statuses.map((status) => {
            const statusItems = items.filter((item) => item.status === status);
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
                            href={item.application_url || item.internship_source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-2 inline-block text-sm text-blue-300 hover:text-blue-200"
                          >
                            View application
                          </a>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <select
                            value={item.status}
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
