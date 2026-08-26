"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/already registered|already exists/i.test(message)) return "An account with this email already exists.";
  return "Authentication could not be completed. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim() || !password) return setError("Email and password are required.");
    if (mode === "signup" && password !== confirmPassword) return setError("Passwords do not match.");
    setBusy(true);
    const supabase = createClient();
    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setBusy(false);
      if (signInError) return setError(friendlyAuthError(signInError.message));
      router.push("/");
      router.refresh();
      return;
    }
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (signUpError) return setError(friendlyAuthError(signUpError.message));
    if (data.session) {
      router.push("/");
      router.refresh();
    } else {
      setMessage("Account created. Check your email to confirm your account before signing in.");
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-md">
        <Link href="/" className="text-sm font-medium text-blue-400">InternScout AI</Link>
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="mb-6 flex rounded-lg bg-slate-800 p-1">
            <button type="button" onClick={() => { setMode("signin"); setError(""); }} className={`flex-1 rounded-md py-2 text-sm ${mode === "signin" ? "bg-blue-500 text-white" : "text-slate-300"}`}>Sign In</button>
            <button type="button" onClick={() => { setMode("signup"); setError(""); }} className={`flex-1 rounded-md py-2 text-sm ${mode === "signup" ? "bg-blue-500 text-white" : "text-slate-300"}`}>Create Account</button>
          </div>
          <h1 className="text-2xl font-bold">{mode === "signin" ? "Welcome back" : "Create your account"}</h1>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" autoComplete="email" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none" />
            <input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" autoComplete={mode === "signin" ? "current-password" : "new-password"} className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none" />
            {mode === "signup" && <input type="password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Confirm password" autoComplete="new-password" className="w-full rounded-lg border border-slate-700 bg-slate-800 p-3 outline-none" />}
            {error && <p className="text-sm text-red-400">{error}</p>}
            {message && <p className="text-sm text-green-400">{message}</p>}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-blue-500 py-3 font-semibold hover:bg-blue-600 disabled:opacity-60">{busy ? "Please wait..." : mode === "signin" ? "Sign In" : "Create Account"}</button>
          </form>
        </div>
      </div>
    </main>
  );
}
