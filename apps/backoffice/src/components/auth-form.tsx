"use client";

import { ArrowRight, Check, Eye, EyeOff, Lock } from "lucide-react";
import { useState } from "react";

/** Input with an icon on the left and room for a button on the right. */
export const authField =
  "peer h-12 w-full [@media(max-height:720px)]:h-11 rounded-xl border border-line-strong/80 bg-surface pr-11 pl-11 text-[15px] text-ink shadow-sm shadow-ink/[0.03] transition-all duration-200 placeholder:text-ink-faint hover:border-line-strong focus:border-ledger-600 focus:ring-4 focus:ring-ledger-600/10 focus:outline-none";
export const authFieldIcon =
  "pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-ink-faint transition-colors duration-200 peer-focus:text-ledger-600 group-hover:text-ledger-600 [.group:hover:not(:focus-within)_&]:animate-hop";
/** Wraps a field and its icon. */
export const authFieldBox = "group relative rounded-xl [&:hover:not(:focus-within)]:animate-dance";

/** A password input with a lock icon and a show/hide button. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  minLength,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={authFieldBox}>
      <input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        placeholder="••••••••"
        className={authField}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <Lock className={authFieldIcon} aria-hidden />
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
  );
}

export type AuthFormState = "idle" | "busy" | "done";

/** The big green submit button: a label, then a spinner while it works, then a tick. */
export function AuthSubmit({ state, idle, busy, done }: { state: AuthFormState; idle: string; busy: string; done: string }) {
  return (
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
          <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden /> {busy}
        </>
      )}
      {state === "done" && (
        <>
          <span className="flex size-5 animate-pop items-center justify-center rounded-full bg-white text-emerald-600">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
          {done}
        </>
      )}
      {state === "idle" && (
        <>
          {idle}
          <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
        </>
      )}
    </button>
  );
}
