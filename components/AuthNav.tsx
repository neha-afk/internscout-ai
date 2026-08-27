"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import NotificationBell from "@/components/NotificationBell";

export default function AuthNav() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    void supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return null;
  if (!email) {
    return <Link href="/login" className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">Sign In</Link>;
  }

  return (
    <div className="flex items-center gap-3">
      <Link href="/resume" className="hidden text-sm text-slate-300 hover:text-white sm:inline">Resume Match</Link>
      <span className="hidden max-w-40 truncate text-xs text-slate-400 sm:inline">{email}</span>
      <NotificationBell />
      <button type="button" onClick={async () => { await createClient().auth.signOut(); router.push("/"); router.refresh(); }} className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">Sign Out</button>
    </div>
  );
}
