"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SearchableMultiSelect from "@/components/SearchableMultiSelect";
import AuthNav from "@/components/AuthNav";
import type {
  JobAlert,
  PreferredWorkMode,
  UserPreferences,
} from "@/types/internship";

const workModes: PreferredWorkMode[] = ["remote", "hybrid", "onsite"];

function readableDate(value: string | null): string {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not checked yet" : date.toLocaleString();
}

export default function AlertsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<JobAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [selectedModes, setSelectedModes] = useState<PreferredWorkMode[]>([]);
  const [minimumScore, setMinimumScore] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        setError("Please sign in to manage job alerts.");
        setLoading(false);
        return;
      }
      setUserId(authData.user.id);
      const [{ data: alertData, error: alertError }, { data: preferenceData }] =
        await Promise.all([
          supabase.from("job_alerts").select("*").eq("user_id", authData.user.id).order("created_at", { ascending: false }),
          supabase.from("user_preferences").select("*").eq("user_id", authData.user.id).maybeSingle(),
        ]);
      if (cancelled) return;
      if (alertError) {
        setError("Unable to load your job alerts.");
      } else {
        setAlerts((alertData ?? []) as JobAlert[]);
      }
      if (preferenceData) {
        const preferences = preferenceData as UserPreferences;
        setRoles(preferences.preferred_roles ?? []);
        setLocations(preferences.preferred_locations ?? []);
        setSkills(preferences.skills ?? []);
        setSelectedModes(preferences.preferred_work_modes ?? []);
      }
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setRoles([]);
    setLocations([]);
    setSkills([]);
    setSelectedModes([]);
    setMinimumScore("");
  }

  function editAlert(alert: JobAlert) {
    setEditingId(alert.id);
    setName(alert.name);
    setRoles(alert.roles);
    setLocations(alert.locations);
    setSkills(alert.skills);
    setSelectedModes(alert.work_modes);
    setMinimumScore(alert.minimum_match_score === null ? "" : String(alert.minimum_match_score));
    setMessage("");
    setError("");
  }

  async function saveAlert() {
    if (!userId) return setError("Please sign in to save job alerts.");
    const score = minimumScore === "" ? null : Number(minimumScore);
    if (!name.trim()) return setError("Alert name is required.");
    if (score !== null && (!Number.isInteger(score) || score < 0 || score > 100)) {
      return setError("Minimum match score must be an integer from 0 to 100.");
    }
    setSaving(true);
    setError("");
    setMessage("");
    const payload = {
      user_id: userId,
      name: name.trim(),
      roles,
      work_modes: selectedModes,
      locations,
      skills,
      minimum_match_score: score,
    };
    const result = editingId
      ? await supabase.from("job_alerts").update(payload).eq("id", editingId).eq("user_id", userId).select().single()
      : await supabase.from("job_alerts").insert(payload).select().single();
    setSaving(false);
    if (result.error) {
      setError("Unable to save this job alert.");
      return;
    }
    if (editingId) {
      setAlerts((current) => current.map((alert) => alert.id === editingId ? result.data as JobAlert : alert));
      setMessage("Job alert updated.");
    } else {
      setAlerts((current) => [result.data as JobAlert, ...current]);
      setMessage("Job alert created.");
    }
    resetForm();
  }

  async function toggleAlert(alert: JobAlert) {
    const { error: updateError } = await supabase.from("job_alerts").update({ is_active: !alert.is_active }).eq("id", alert.id).eq("user_id", userId);
    if (updateError) return setError("Unable to update this job alert.");
    setAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, is_active: !item.is_active } : item));
  }

  async function deleteAlert(id: string) {
    const { error: deleteError } = await supabase.from("job_alerts").delete().eq("id", id).eq("user_id", userId);
    if (deleteError) return setError("Unable to delete this job alert.");
    setAlerts((current) => current.filter((alert) => alert.id !== id));
    if (editingId === id) resetForm();
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-300">Loading job alerts...</main>;
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex items-center justify-between">
          <div><p className="text-sm font-medium text-blue-400">InternScout AI</p><h1 className="mt-1 text-3xl font-bold">Job Alerts</h1></div>
          <div className="flex items-center gap-4"><nav className="flex gap-4 text-sm text-slate-300"><a href="/dashboard" className="hover:text-white">Dashboard</a><a href="/" className="hover:text-white">Home</a><a href="/tracker" className="hover:text-white">Tracker</a><a href="/preferences" className="hover:text-white">Preferences</a><a href="/recommendations" className="hover:text-white">Recommendations</a><a href="/alerts/matches" className="hover:text-white">Alert Matches</a></nav><AuthNav /></div>
        </header>
        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        {message && <p className="mb-4 text-sm text-green-400">{message}</p>}

        {userId && <section className="mb-10 space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <h2 className="text-xl font-semibold">{editingId ? "Edit alert" : "Create an alert"}</h2>
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Alert name" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3" />
          <SearchableMultiSelect label="Roles" placeholder="Search roles" value={roles} onChange={setRoles} suggestionType="roles" allowCustomValue />
          <SearchableMultiSelect label="Locations" placeholder="Search locations" value={locations} onChange={setLocations} suggestionType="locations" allowCustomValue />
          <SearchableMultiSelect label="Skills" placeholder="Search skills" value={skills} onChange={setSkills} suggestionType="skills" allowCustomValue />
          <div><p className="mb-2 text-sm font-medium text-slate-300">Work modes</p><div className="flex flex-wrap gap-2">{workModes.map((mode) => <button key={mode} type="button" onClick={() => setSelectedModes((current) => current.includes(mode) ? current.filter((item) => item !== mode) : [...current, mode])} className={`rounded-lg border px-4 py-2 text-sm ${selectedModes.includes(mode) ? "border-blue-400 bg-blue-400/20 text-blue-200" : "border-slate-700 bg-slate-800 text-slate-300"}`}>{mode}</button>)}</div></div>
          <label className="block text-sm text-slate-300">Minimum match score (optional)<input type="number" min="0" max="100" value={minimumScore} onChange={(event) => setMinimumScore(event.target.value)} placeholder="0–100" className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 p-3" /></label>
          <div className="flex gap-3"><button type="button" onClick={() => void saveAlert()} disabled={saving} className="rounded-lg bg-blue-500 px-5 py-3 font-semibold hover:bg-blue-600 disabled:opacity-60">{saving ? "Saving..." : editingId ? "Update Alert" : "Create Alert"}</button>{editingId && <button type="button" onClick={resetForm} className="rounded-lg border border-slate-700 px-5 py-3 text-slate-300">Cancel</button>}</div>
        </section>}

        {!userId ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">Please sign in to create and manage job alerts.</div> : alerts.length === 0 ? <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-slate-300">No job alerts yet.</div> : <div className="space-y-4">{alerts.map((alert) => <article key={alert.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-6"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><h2 className="text-xl font-semibold">{alert.name}</h2><p className="mt-2 text-sm text-slate-400">Roles: {alert.roles.join(", ") || "Any"}</p><p className="text-sm text-slate-400">Modes: {alert.work_modes.join(", ") || "Any"}</p><p className="text-sm text-slate-400">Locations: {alert.locations.join(", ") || "Any"}</p><p className="text-sm text-slate-400">Skills: {alert.skills.join(", ") || "Any"}</p>{alert.minimum_match_score !== null && <p className="text-sm text-slate-400">Minimum match: {alert.minimum_match_score}%</p>}<p className="mt-2 text-xs text-slate-500">Last checked: {readableDate(alert.last_checked_at)}</p></div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs ${alert.is_active ? "bg-emerald-400/15 text-emerald-300" : "bg-slate-700 text-slate-300"}`}>{alert.is_active ? "Active" : "Inactive"}</span><button type="button" onClick={() => void toggleAlert(alert)} className="rounded-lg border border-slate-700 px-3 py-2 text-sm">{alert.is_active ? "Pause" : "Activate"}</button><button type="button" onClick={() => editAlert(alert)} className="rounded-lg border border-blue-400/40 px-3 py-2 text-sm text-blue-300">Edit</button><button type="button" onClick={() => void deleteAlert(alert.id)} className="rounded-lg border border-red-400/40 px-3 py-2 text-sm text-red-300">Delete</button></div></div></article>)}</div>}
      </div>
    </main>
  );
}
