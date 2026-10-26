"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button, Field, FormError, Input } from "@/components/ui";
import { api, platformTokenStore } from "@/lib/api";

export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("expired") ? "Your platform session ended. Sign in again." : null,
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ink via-[#1d2a33] to-ledger-950 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-between">
          <BrandMark inverted />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white ring-1 ring-white/15">
            <ShieldCheck className="size-3.5" aria-hidden /> Platform console
          </span>
        </div>
        <form
          className="card flex flex-col gap-5 p-8"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setBusy(true);
            try {
              const res = await api<{ accessToken: string }>("/platform/login", { method: "POST", body: { email, password }, platform: true });
              platformTokenStore.set(res.accessToken);
              router.replace("/platform");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not sign in");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Floatly staff sign-in</h1>
            <p className="mt-1 text-sm text-ink-soft">Every business on Floatly, for the people who run it. Business owners sign in at the normal page.</p>
          </div>
          <Field label="Email">{(id) => <Input id={id} type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Password">{(id) => <Input id={id} type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <FormError message={error} />
          <Button type="submit" busy={busy} className="h-11">
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
