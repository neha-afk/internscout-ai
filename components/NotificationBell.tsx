"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
};

type MatchRow = { id: string; internship_source_url: string; detected_at: string; job_alerts: { name: string } | { name: string }[] | null };
type DateRow = { id: string; application_deadline: string | null; follow_up_date: string | null };

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function daysFromToday(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function useNotifications() {
  const supabase = useMemo(() => createClient(), []);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadNotifications() {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) {
      setAuthenticated(false);
      setLoading(false);
      return;
    }
    setAuthenticated(true);
    const { data: existing, error: notificationError } = await supabase.from("notifications").select("id, type, title, message, link, is_read, created_at").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(50);
    if (notificationError) {
      setError("Unable to load notifications. Apply the notifications database migration first.");
      setLoading(false);
      return;
    }

    const [matchesQuery, datesQuery] = await Promise.all([
      supabase.from("job_alert_matches").select("id, internship_source_url, detected_at, job_alerts(name)").order("detected_at", { ascending: false }).limit(20),
      supabase.from("saved_internships").select("id, application_deadline, follow_up_date").eq("user_id", authData.user.id),
    ]);
    const candidates: Array<Omit<AppNotification, "id" | "is_read" | "created_at"> & { user_id: string; dedupe_key: string }> = [];
    for (const match of (matchesQuery.data ?? []) as MatchRow[]) {
      const alert = Array.isArray(match.job_alerts) ? match.job_alerts[0] : match.job_alerts;
      candidates.push({ user_id: authData.user.id, dedupe_key: `match:${match.id}`, type: "job_match", title: "New internship match found", message: `${alert?.name ?? "An alert"} found a matching internship.`, link: "/alerts/matches" });
    }
    for (const row of (datesQuery.data ?? []) as DateRow[]) {
      if (row.application_deadline) {
        const days = daysFromToday(row.application_deadline);
        if (days >= 0 && days <= 3) candidates.push({ user_id: authData.user.id, dedupe_key: `deadline:${row.id}:${row.application_deadline}`, type: "deadline", title: days === 0 ? "Application deadline today" : days === 1 ? "Application deadline tomorrow" : "Application deadline due soon", message: days === 0 ? "An application deadline is due today." : `An application deadline is due in ${days} days.`, link: "/tracker" });
      }
      if (row.follow_up_date) {
        const days = daysFromToday(row.follow_up_date);
        if (days >= 0 && days <= 1) candidates.push({ user_id: authData.user.id, dedupe_key: `followup:${row.id}:${row.follow_up_date}`, type: "follow_up", title: days === 0 ? "Follow-up due today" : "Follow-up due tomorrow", message: days === 0 ? "A tracked follow-up is due today." : "A tracked follow-up is due tomorrow.", link: "/tracker" });
      }
    }
    if (candidates.length > 0) {
      await supabase.from("notifications").upsert(candidates, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
      const { data: refreshed } = await supabase.from("notifications").select("id, type, title, message, link, is_read, created_at").eq("user_id", authData.user.id).order("created_at", { ascending: false }).limit(50);
      setNotifications((refreshed ?? []) as AppNotification[]);
    } else {
      setNotifications((existing ?? []) as AppNotification[]);
    }
    setLoading(false);
  }

  useEffect(() => { void loadNotifications(); }, [supabase]);

  async function markRead(id: string) {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("id", id).eq("user_id", authData.user.id);
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, is_read: true } : item));
  }

  async function markAllRead() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", authData.user.id).eq("is_read", false);
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
  }

  return { notifications, authenticated, loading, error, markRead, markAllRead, reload: loadNotifications };
}

export default function NotificationBell() {
  const { notifications, authenticated, loading } = useNotifications();
  const [open, setOpen] = useState(false);
  if (!authenticated || loading) return null;
  const unread = notifications.filter((notification) => !notification.is_read).length;
  return <div className="relative"><button type="button" aria-label="Notifications" onClick={() => setOpen((value) => !value)} className="relative rounded-lg bg-slate-800 px-3 py-2 text-lg hover:bg-slate-700">🔔{unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-blue-500 px-1 text-center text-xs text-white">{unread > 9 ? "9+" : unread}</span>}</button>{open && <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-xl"><div className="mb-2 flex items-center justify-between"><p className="font-semibold">Notifications</p><Link href="/notifications" className="text-xs text-blue-300">View all</Link></div>{notifications.length === 0 ? <p className="p-3 text-sm text-slate-400">No notifications yet.</p> : notifications.slice(0, 5).map((notification) => <Link key={notification.id} href={notification.link ?? "/notifications"} className={`block rounded-lg p-2 text-sm hover:bg-slate-800 ${notification.is_read ? "text-slate-400" : "text-white"}`}><p className="font-medium">{notification.title}</p><p className="text-xs text-slate-400">{notification.message} · {relativeTime(notification.created_at)}</p></Link>)}</div>}</div>;
}
