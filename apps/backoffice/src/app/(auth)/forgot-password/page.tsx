"use client";

import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { authField, authFieldBox, authFieldIcon, type AuthFormState, AuthSubmit } from "@/components/auth-form";
import { AuthCard, stagger } from "@/components/auth-showcase";
import { FormError } from "@/components/ui";
import { api } from "@/lib/api";

const noop = () => () => {};

/** "Forgot password": asks for the email and sends it a link to choose a new password. */
export default function ForgotPasswordPage() {
  // The sign-in page passes on what was typed there. Read on the client only.
  const fromSignIn = useSyncExternalStore(
    noop,
    () => new URLSearchParams(window.location.search).get("email") ?? "",
    () => "",
  );
  const [typed, setTyped] = useState<string | null>(null);
  const email = typed ?? fromSignIn;
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AuthFormState>("idle");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [shake, setShake] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("busy");
    setError(null);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email } });
      setSentTo(email.trim());
    } catch (err) {
      setError((err as Error).message);
      setShake((n) => n + 1);
    }
    setState("idle");
  }

  if (sentTo) {
    return (
      <AuthCard>
        <div {...stagger(0)}>
          <span className="flex size-12 items-center justify-center rounded-2xl bg-ledger-50 text-ledger-700">
            <MailCheck className="size-6" aria-hidden />
          </span>
          <h1 className="mt-4 text-[28px] leading-tight font-semibold tracking-tight">Check your email</h1>
          <p className="mt-2 text-sm text-ink-soft">
            If <span className="font-medium text-ink">{sentTo}</span> has a Floatly login, we&apos;ve sent it a link to choose a new password. The link works for 60
            minutes.
          </p>
          <p className="mt-3 text-sm text-ink-soft">Nothing there? Look in the spam folder, or ask again in a minute.</p>
        </div>
        <div {...stagger(1)} className="mt-8 flex flex-col gap-3 animate-fade-up">
          <button
            type="button"
            onClick={() => setSentTo(null)}
            className="flex h-11 w-full items-center justify-center rounded-xl border border-line bg-surface text-sm font-medium text-ink shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-ledger-600/40 hover:bg-ledger-50/50 hover:shadow-md"
          >
            Use another email, or send it again
          </button>
          <BackToSignIn />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard shakeKey={shake}>
      <div {...stagger(0)}>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Forgot your password?</h1>
        <p className="mt-1.5 text-sm text-ink-soft">Enter the email you sign in with. We&apos;ll send you a link to choose a new password.</p>
      </div>

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
              autoFocus
              placeholder="you@business.co.zw"
              className={authField}
              value={email}
              onChange={(e) => setTyped(e.target.value)}
            />
            <Mail className={authFieldIcon} aria-hidden />
          </div>
        </div>

        {error && (
          <div className="animate-fade-up">
            <FormError message={error} />
          </div>
        )}

        <div {...stagger(2)}>
          <AuthSubmit state={state} idle="Send the link" busy="Sending…" done="Sent" />
        </div>
      </form>

      <div {...stagger(3)} className="mt-6 animate-fade-up">
        <BackToSignIn />
      </div>
    </AuthCard>
  );
}

function BackToSignIn() {
  return (
    <Link href="/login" className="flex items-center justify-center gap-1.5 text-sm font-medium text-ledger-700 hover:text-ledger-600 hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> Back to sign in
    </Link>
  );
}
