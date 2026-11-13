"use client";

import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { type AuthFormState, AuthSubmit, PasswordInput } from "@/components/auth-form";
import { AuthCard, stagger } from "@/components/auth-showcase";
import { FormError, Spinner } from "@/components/ui";
import { api, tokenStore } from "@/lib/api";

const noop = () => () => {};

/**
 * Opened from the "forgot password" email. The token comes after # in the link, so it
 * never reaches a server log. Choosing a password ends the person's other sign-ins.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  // null until the page has read the link in the browser.
  const token = useSyncExternalStore<string | null>(
    noop,
    () => window.location.hash.slice(1),
    () => null,
  );
  const link = useQuery({
    queryKey: ["reset-password", token],
    queryFn: () => api<{ email: string }>("/auth/reset-password/check", { method: "POST", body: { token } }),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AuthFormState>("idle");
  const [shake, setShake] = useState(0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = password.length < 8 ? "Use at least 8 characters." : password !== again ? "The two passwords are different." : null;
    if (problem) {
      setError(problem);
      setShake((n) => n + 1);
      return;
    }
    setState("busy");
    setError(null);
    try {
      await api("/auth/reset-password", { method: "POST", body: { token, password } });
      // Any sign-in kept in this browser ended with the reset.
      tokenStore.clear();
      setState("done");
      setTimeout(() => router.replace("/login?reset=1"), 900);
    } catch (err) {
      setError((err as Error).message);
      setShake((n) => n + 1);
      setState("idle");
    }
  }

  if (token === "" || link.isError) {
    return (
      <AuthCard>
        <div {...stagger(0)}>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight">This link doesn&apos;t work</h1>
          <div className="mt-4">
            <FormError message={link.error?.message ?? "Open the link from the email again, or ask for a new one."} />
          </div>
        </div>
        <div {...stagger(1)} className="mt-8 flex flex-col gap-4 animate-fade-up">
          <Link
            href="/forgot-password"
            className="flex h-11 w-full items-center justify-center rounded-xl bg-ledger-700 text-sm font-semibold text-white shadow-sm transition hover:bg-ledger-600"
          >
            Send me a new link
          </Link>
          <Link href="/login" className="text-center text-sm font-medium text-ledger-700 hover:text-ledger-600 hover:underline">
            Back to sign in
          </Link>
        </div>
      </AuthCard>
    );
  }

  if (!link.data) {
    return (
      <AuthCard>
        <div className="flex justify-center">
          <Spinner label="Checking the link…" />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard shakeKey={shake}>
      <div {...stagger(0)}>
        <span className="flex size-12 items-center justify-center rounded-2xl bg-ledger-50 text-ledger-700">
          <KeyRound className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-[28px] leading-tight font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          For <span className="font-medium text-ink">{link.data.email}</span>. You&apos;ll be signed out everywhere else, except on tills.
        </p>
      </div>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-5 [@media(max-height:720px)]:mt-5 [@media(max-height:720px)]:gap-3.5">
        {/* Lets password managers save the new password against the right login. */}
        <input type="email" name="email" autoComplete="username" value={link.data.email} readOnly hidden />
        <div {...stagger(1)}>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
            New password
          </label>
          <PasswordInput id="password" autoComplete="new-password" minLength={8} value={password} onChange={setPassword} />
          <p className="mt-1.5 text-xs text-ink-faint">At least 8 characters.</p>
        </div>
        <div {...stagger(2)}>
          <label htmlFor="again" className="mb-1.5 block text-sm font-medium">
            Type it again
          </label>
          <PasswordInput id="again" autoComplete="new-password" value={again} onChange={setAgain} />
        </div>

        {error && (
          <div className="animate-fade-up">
            <FormError message={error} />
          </div>
        )}

        <div {...stagger(3)}>
          <AuthSubmit state={state} idle="Save the new password" busy="Saving…" done="Password changed" />
        </div>
      </form>
    </AuthCard>
  );
}
