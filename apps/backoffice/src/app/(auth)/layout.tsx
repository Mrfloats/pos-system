import { AuthShowcase } from "@/components/auth-showcase";
import { BrandMark } from "@/components/brand-mark";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid h-dvh overflow-hidden lg:grid-cols-[minmax(0,6fr)_minmax(0,7fr)]">
      <AuthShowcase />
      <main className="relative flex h-dvh flex-col overflow-x-hidden overflow-y-auto px-4 py-6 sm:px-8 [@media(max-height:700px)]:py-3">
        {/* Soft colour behind the form, clipped so it never makes the column scroll */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 right-0 size-96 animate-drift rounded-full bg-emerald-300/20 blur-3xl" />
          <div className="absolute -bottom-40 -left-10 size-96 animate-drift-reverse rounded-full bg-sky-300/15 blur-3xl" />
        </div>
        {/* my-auto centres the form when it fits, and lets it scroll from the top when it doesn't */}
        <div className="relative m-auto w-full max-w-md animate-fade-up">
          <BrandMark className="mb-6 lg:hidden [@media(max-height:700px)]:mb-3" />
          {children}
        </div>
      </main>
    </div>
  );
}
