"use client";

import { CheckCircle2, ShieldCheck, TrendingUp, WifiOff, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BrandMark } from "@/components/brand-mark";

const WORDS = ["till", "shelf", "kitchen", "warehouse"];

const RECEIPT: [string, string][] = [
  ["Mealie Meal 10kg", "7.50"],
  ["Cooking Oil 2L × 2", "9.60"],
  ["Coca-Cola 500ml (case)", "21.00"],
  ["Bread Loaf", "1.10"],
];

const FEATURES = [
  { icon: Zap, text: "Ring up sales in seconds" },
  { icon: WifiOff, text: "Keeps selling when the internet drops" },
  { icon: ShieldCheck, text: "Books, VAT and stock kept for you" },
];

/** A headline word that changes every few seconds. */
function CyclingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % WORDS.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="relative inline-block overflow-hidden align-bottom">
      <span key={WORDS[i]} className="inline-block animate-word bg-gradient-to-r from-emerald-200 via-teal-200 to-sky-200 bg-clip-text text-transparent">
        {WORDS[i]}
      </span>
    </span>
  );
}

/** Natural size of the receipt scene, before scaling. */
const SCENE = { width: 544, height: 288 };

/**
 * Holds the receipt scene in whatever space is left below the text, shrinking
 * it to fit (browser zoom and display scaling change that space), and fading it
 * out when there's too little room to show it nicely. It never overlaps the text.
 */
function FitScene({ children }: { children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientHeight / SCENE.height, el.clientWidth / SCENE.width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} aria-hidden className="relative min-h-0 w-full flex-1">
      <div
        className={`absolute bottom-0 left-0 origin-bottom-left transition-opacity duration-300 ${scale < 0.45 ? "opacity-0" : "opacity-100"}`}
        style={{ width: SCENE.width, height: SCENE.height, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

/** The decorative left half of the sign-in and sign-up screens. */
export function AuthShowcase() {
  return (
    <aside className="relative hidden overflow-hidden bg-gradient-to-br from-[#0f3d30] via-ledger-950 to-[#071f18] p-10 text-ledger-50 lg:flex lg:h-dvh lg:flex-col lg:gap-6 [@media(max-height:760px)]:p-8">
      {/* Slowly moving light */}
      <div aria-hidden className="pointer-events-none absolute -top-32 -right-24 size-[30rem] animate-drift rounded-full bg-emerald-400/25 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] animate-drift-reverse rounded-full bg-sky-400/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute top-1/2 left-1/3 size-72 animate-drift rounded-full bg-teal-300/10 blur-3xl [animation-delay:-6s]" />
      {/* Fine dot grid, fading out towards the bottom */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:radial-gradient(rgb(255_255_255/0.6)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
      />

      <BrandMark inverted className="relative animate-fade-up" />

      <div className="relative max-w-md shrink-0 [@media(min-height:800px)]:mt-auto">
        <p className="animate-fade-up text-4xl leading-[1.15] [@media(max-height:760px)]:text-3xl font-semibold tracking-tight text-white [animation-delay:120ms]">
          Every <CyclingWord />
          <br />
          in one place.
        </p>
        <p className="mt-4 animate-fade-up text-[15px] leading-relaxed text-emerald-50/70 [animation-delay:240ms]">
          Products, prices, stock, staff and the books for your shops, warehouses and restaurants.
        </p>
        <ul className="mt-7 flex flex-col gap-3 [@media(max-height:760px)]:mt-5 [@media(max-height:760px)]:gap-2 [@media(max-height:680px)]:hidden">
          {FEATURES.map(({ icon: Icon, text }, i) => (
            <li key={text} className="flex animate-fade-up items-center gap-3 text-sm text-emerald-50/85" style={{ animationDelay: `${360 + i * 110}ms` }}>
              <span className="flex size-8 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 backdrop-blur">
                <Icon className="size-4 text-emerald-200" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>

      {/* A receipt printing, with two cards floating around it */}
      <FitScene>
        <div className="absolute bottom-0 left-4 w-72 animate-float [--tilt:-3deg]">
          <div className="rounded-t-2xl bg-white px-5 pt-5 pb-6 font-medium text-ledger-950 shadow-2xl shadow-black/40">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold tracking-[0.14em] text-ink-faint uppercase">
              <span>Main Store · Till 1</span>
              <span>S-01042</span>
            </div>
            {RECEIPT.map(([name, price], i) => (
              <div key={name} className="flex animate-print justify-between border-b border-dashed border-ledger-900/20 py-1.5 text-sm" style={{ animationDelay: `${700 + i * 380}ms` }}>
                <span>{name}</span>
                <span className="tabular-nums">{price}</span>
              </div>
            ))}
            <div className="mt-3 flex animate-print justify-between text-base font-semibold" style={{ animationDelay: `${700 + RECEIPT.length * 380}ms` }}>
              <span>Total USD</span>
              <span className="tabular-nums">39.20</span>
            </div>
          </div>
          {/* Torn paper edge */}
          <div className="h-3 bg-[linear-gradient(135deg,white_50%,transparent_50%),linear-gradient(225deg,white_50%,transparent_50%)] bg-[length:12px_12px] bg-repeat-x" />
        </div>

        <div className="absolute top-2 right-6 animate-pop [animation-delay:2.6s]">
          <div className="flex animate-float-slow items-center gap-3 rounded-2xl bg-white/95 px-4 py-3 text-ink shadow-xl shadow-black/30 [--tilt:2deg]">
            <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-ledger-600 text-white">
              <CheckCircle2 className="size-5" />
            </span>
            <span>
              <span className="block text-xs text-ink-faint">Sale complete</span>
              <span className="block text-sm font-semibold">+ USD 39.20</span>
            </span>
          </div>
        </div>

        <div className="absolute right-0 bottom-6 animate-pop [animation-delay:3.1s]">
          <div className="w-44 animate-float rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-md [--tilt:-2deg] [animation-delay:-2s]">
            <p className="flex items-center gap-1.5 text-xs text-emerald-100/80">
              <TrendingUp className="size-3.5" /> Today&apos;s takings
            </p>
            <p className="mt-1 text-xl font-semibold text-white tabular-nums">USD 1,284</p>
            <div className="mt-3 flex h-10 items-end gap-1">
              {[35, 55, 42, 70, 60, 88, 100].map((h, i) => (
                <span
                  key={i}
                  className="flex-1 origin-bottom animate-grow rounded-t bg-gradient-to-t from-emerald-500 to-emerald-300"
                  style={{ height: `${h}%`, animationDelay: `${3.3 + i * 0.08}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      </FitScene>
    </aside>
  );
}

/** The white card holding a sign-in or sign-up form. Changing `shakeKey` shakes it once (a wrong password). */
export function AuthCard({ children, shakeKey = 0 }: { children: React.ReactNode; shakeKey?: number }) {
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Shake in place, so the form isn't rebuilt and its entrance doesn't replay.
    if (!shakeKey || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    card.current?.animate(
      [0, -8, 8, -6, 6, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 450, easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)" },
    );
  }, [shakeKey]);
  return (
    <div ref={card} className="card relative overflow-hidden p-7 sm:p-9 [@media(max-height:720px)]:p-6">
      {/* A thin moving highlight along the top edge */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-gradient-to-r from-emerald-400 via-teal-400 to-sky-400">
        <span className="absolute inset-y-0 w-1/3 animate-shimmer bg-white/60 blur-sm" />
      </div>
      {children}
    </div>
  );
}

/** Staggered entry for the parts of a form: pass the position (0, 1, 2…). */
export const stagger = (i: number) => ({ className: "animate-fade-up", style: { animationDelay: `${150 + i * 70}ms` } });
