"use client";

import { ArrowRight, Check, Eye, EyeOff, Lock, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { AuthCard, stagger } from "@/components/auth-showcase";
import { FormError } from "@/components/ui";
import { api, Session } from "@/lib/api";
import { startSession } from "@/lib/session";

const noop = () => () => {};

/** Input with an icon on the left and room for a button on the right. */
const field =
  "peer h-12 w-full [@media(max-height:720px)]:h-11 rounded-xl border border-line-strong/80 bg-surface pr-11 pl-11 text-[15px] text-ink shadow-sm shadow-ink/[0.03] transition-all duration-200 placeholder:text-ink-faint hover:border-line-strong focus:border-ledger-600 focus:ring-4 focus:ring-ledger-600/10 focus:outline-none";
const fieldIcon = "pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-ink-faint transition-colors duration-200 peer-focus:text-ledger-600 group-hover:text-ledger-600 [.group:hover:not(:focus-within)_&]:animate-hop";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [shake, setShake] = useState(0);
  // ?expired=1 is added when a session runs out. Read on the client only.
  const expired = useSyncExternalStore(
    noop,
    () => window.location.search.includes("expired"),
    () => false,
  );
  const message = error ?? (expired ? "Your session ended. Sign in again to continue." : null);

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

      <form onSubmit={submit} className="mt-8 flex flex-col gap-5 [@media(max-height:720px)]:mt-5 [@media(max-height:720px)]:gap-3.5">
        <div {...stagger(1)}>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium">
            Email
          </label>
          <div className="group relative rounded-xl [&:hover:not(:focus-within)]:animate-dance">
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@business.co.zw"
              className={field}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Mail className={fieldIcon} aria-hidden />
          </div>
        </div>

        <div {...stagger(2)}>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            Password
          </label>
          <div className="group relative rounded-xl [&:hover:not(:focus-within)]:animate-dance">
            <input
              id="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className={field}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Lock className={fieldIcon} aria-hidden />
            <button
              type="button"
              onClick={() => setShow(!show)}
              className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-faint transition hover:bg-paper hover:text-ink"
              aria-label={show ? "Hide password" : "Show password"}
              aria-pressed={show}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>

        {message && (
          <div className="animate-fade-up">
            <FormError message={message} />
          </div>
        )}

        <div {...stagger(3)}>
          <button
            type="submit"
            disabled={state !== "idle"}
            className={`group relative mt-1 flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-[15px] font-semibold text-white shadow-lg transition-all duration-300 active:scale-[0.98] disabled:cursor-default ${
              state === "done"
                ? "bg-gradient-to-r from-emerald-500 to-teal-500 shadow-emerald-600/30"
                : "bg-gradient-to-r from-ledger-700 via-ledger-600 to-ledger-700 bg-[length:200%_100%] bg-left shadow-ledger-900/25 hover:bg-right hover:shadow-xl hover:shadow-ledger-900/30"
            }`}
          >
            {/* Light sweeping across the button */}
            {state === "idle" && <span aria-hidden className="absolute inset-y-0 left-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/25 to-transparent" />}
            {state === "busy" && (
              <>
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> Signing in…
              </>
            )}
            {state === "done" && (
              <>
                <span className="flex size-5 animate-pop items-center justify-center rounded-full bg-white text-emerald-600">
                  <Check className="size-3.5" strokeWidth={3} />
                </span>
                Welcome back
              </>
            )}
            {state === "idle" && (
              <>
                Sign in
                <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
              </>
            )}
          </button>
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
