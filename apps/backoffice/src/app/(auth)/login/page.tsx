"use client";

import { Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { authField, authFieldBox, authFieldIcon, type AuthFormState, AuthSubmit, PasswordInput } from "@/components/auth-form";
import { AuthCard, stagger } from "@/components/auth-showcase";
import { FormError } from "@/components/ui";
import { api, Session } from "@/lib/api";
import { startSession } from "@/lib/session";

const noop = () => () => {};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AuthFormState>("idle");
  const [shake, setShake] = useState(0);
  // ?expired=1 is added when a session runs out; ?reset=1 after choosing a new password. Read on the client only.
  const search = useSyncExternalStore(
    noop,
    () => window.location.search,
    () => "",
  );
  const reset = search.includes("reset");
  const message = error ?? (!reset && search.includes("expired") ? "Your session ended. Sign in again to continue." : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      const session = await api<Session>("/auth/login", { method: "POST", body: { email, password } });
      startSession(session);
      // A moment to show the tick before the app opens.
      setState("done");
      setTimeout(() => router.replace("/"), 650);
    } catch (err) {
      setError((err as Error).message);
      setShake((n) => n + 1);
      setState("idle");
    }
  }

  return (
    <AuthCard shakeKey={shake}>
      <div {...stagger(0)}>
        <p className="text-sm font-medium text-ledger-700">Welcome back 👋</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">Sign in to Floatly</h1>
        <p className="mt-1.5 text-sm text-ink-soft">Use the email and password for your business account.</p>
      </div>

      {reset && !error && (
        <p role="status" className="mt-6 rounded-xl border border-emerald-600/15 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
          Your password was changed. Sign in with the new one.
        </p>
      )}

      <form onSubmit={submit} className="mt-8 flex flex-col gap-5 [@media(max-height:720px)]:mt-5 [@media(max-height:720px)]:gap-3.5">
        <div {...stagger(1)}>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <div className={authFieldBox}>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@business.co.zw"
              className={authField}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Mail className={authFieldIcon} aria-hidden />
          </div>
        </div>

        <div {...stagger(2)}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <Link
              href={email ? `/forgot-password?email=${encodeURIComponent(email)}` : "/forgot-password"}
              className="text-sm font-medium text-ledger-700 hover:text-ledger-600 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={setPassword} />
        </div>

        {message && (
          <div className="animate-fade-up">
            <FormError message={message} />
          </div>
        )}

        <div {...stagger(3)}>
          <AuthSubmit state={state} idle="Sign in" busy="Signing in…" done="Welcome back" />
        </div>
      </form>

      <div {...stagger(4)}>
        <div className="my-6 flex items-center gap-3 text-xs text-ink-faint [@media(max-height:720px)]:my-4">
          <span className="h-px flex-1 bg-line" />
          New to Floatly?
          <span className="h-px flex-1 bg-line" />
        </div>
        <Link
          href="/signup"
          className="flex h-11 w-full items-center justify-center rounded-xl border border-line bg-surface text-sm font-medium text-ink shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-ledger-600/40 hover:bg-ledger-50/50 hover:shadow-md"
        >
          Create a business account
        </Link>
      </div>
    </AuthCard>
  );
}
