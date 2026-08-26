"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import SearchableMultiSelect from "@/components/SearchableMultiSelect";
import AuthNav from "@/components/AuthNav";
import type {
  ExperienceLevel,
  PreferredWorkMode,
  UserPreferences,
} from "@/types/internship";

const workModes: PreferredWorkMode[] = ["remote", "hybrid", "onsite"];
const experienceLevels: ExperienceLevel[] = [
  "fresher",
  "beginner",
  "intermediate",
  "experienced",
];

function addListValue(value: string, current: string[]): string[] {
  const trimmed = value.trim();
  return trimmed && !current.includes(trimmed) ? [...current, trimmed] : current;
}

export default function PreferencesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [userId, setUserId] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [skills, setSkills] = useState<string[]>([]);
  const [selectedModes, setSelectedModes] = useState<PreferredWorkMode[]>([]);
  const [graduationYear, setGraduationYear] = useState("");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | "">("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadPreferences() {
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (cancelled) return;
      if (authError || !authData.user) {
        setError("Please sign in to manage your preferences.");
        setLoading(false);
        return;
      }
      setUserId(authData.user.id);

      const { data, error: queryError } = await supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", authData.user.id)
        .maybeSingle();
      if (cancelled) return;
      if (queryError) {
        setError("Unable to load your preferences.");
      } else if (data) {
        const preferences = data as UserPreferences;
        setRoles(preferences.preferred_roles ?? []);
        setLocations(preferences.preferred_locations ?? []);
        setSkills(preferences.skills ?? []);
        setSelectedModes(preferences.preferred_work_modes ?? []);
        setGraduationYear(
          preferences.graduation_year === null ||
            preferences.graduation_year === undefined
            ? ""
            : String(preferences.graduation_year)
        );
        setExperienceLevel(preferences.experience_level ?? "");
      }
      setLoading(false);
    }

    void loadPreferences();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  function toggleMode(mode: PreferredWorkMode) {
    setSelectedModes((current) =>
      current.includes(mode)
        ? current.filter((value) => value !== mode)
        : [...current, mode]
    );
  }

  async function savePreferences() {
    if (!userId) {
      setError("Please sign in to save your preferences.");
      return;
    }
    setSaving(true);
    setMessage("");
    setError("");
    const payload = {
      user_id: userId,
      preferred_roles: roles,
      preferred_work_modes: selectedModes,
      preferred_locations: locations,
      skills,
      graduation_year: graduationYear ? Number(graduationYear) : null,
      experience_level: experienceLevel || null,
    };
    const { error: saveError } = await supabase
      .from("user_preferences")
      .upsert(payload, { onConflict: "user_id" });
    setSaving(false);
    if (saveError) {
      setError("Unable to save your preferences.");
      return;
    }
    setMessage("Preferences saved successfully.");
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
        <div className="mx-auto max-w-3xl text-slate-300">Loading preferences...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-blue-400">InternScout AI</p>
            <h1 className="mt-1 text-3xl font-bold">Search Preferences</h1>
          </div>
          <nav className="flex gap-4 text-sm text-slate-300">
            <a href="/dashboard" className="hover:text-white">Dashboard</a>
            <a href="/" className="hover:text-white">Home</a>
            <a href="/tracker" className="hover:text-white">Tracker</a>
            <a href="/recommendations" className="hover:text-white">Recommendations</a>
            <a href="/alerts" className="hover:text-white">Alerts</a>
            <a href="/alerts/matches" className="hover:text-white">Matches</a>
          </nav>
          <AuthNav />
        </div>

        {error && <p className="mb-4 text-sm text-red-400">{error}</p>}
        {message && <p className="mb-4 text-sm text-green-400">{message}</p>}

        <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <SearchableMultiSelect label="Preferred roles" placeholder="Search roles" value={roles} onChange={setRoles} suggestionType="roles" allowCustomValue />
          <SearchableMultiSelect label="Preferred locations" placeholder="Search locations" value={locations} onChange={setLocations} suggestionType="locations" allowCustomValue />
          <SearchableMultiSelect label="Skills" placeholder="Search skills" value={skills} onChange={setSkills} suggestionType="skills" allowCustomValue />

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-slate-300">Preferred work modes</legend>
            <div className="flex flex-wrap gap-2">
              {workModes.map((mode) => (
                <button key={mode} type="button" onClick={() => toggleMode(mode)} className={`rounded-lg border px-4 py-2 text-sm ${selectedModes.includes(mode) ? "border-blue-400 bg-blue-400/20 text-blue-200" : "border-slate-700 bg-slate-800 text-slate-300"}`}>
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm text-slate-300">
            Graduation year
            <select value={graduationYear} onChange={(event) => setGraduationYear(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-white"><option value="">Optional</option>{Array.from({ length: 16 }, (_, index) => new Date().getFullYear() - 5 + index).map((year) => <option key={year} value={year}>{year}</option>)}</select>
          </label>

          <label className="block text-sm text-slate-300">
            Experience level
            <select value={experienceLevel} onChange={(event) => setExperienceLevel(event.target.value as ExperienceLevel | "")} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-800 p-3 text-white">
              <option value="">Select experience level</option>
              {experienceLevels.map((level) => <option key={level} value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</option>)}
            </select>
          </label>

          <button type="button" onClick={() => void savePreferences()} disabled={saving || !userId} className="w-full rounded-lg bg-blue-500 py-3 font-semibold hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? "Saving Preferences..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </main>
  );
}
