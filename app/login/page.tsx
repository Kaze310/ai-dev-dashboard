import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppSession } from "@/lib/auth/session";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getAppSession()) redirect("/");
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-5 py-10 sm:px-6 sm:py-14">
      <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="glass-panel relative overflow-hidden rounded-[34px] px-6 py-8 sm:px-8 sm:py-10">
          <div className="absolute right-0 top-0 h-48 w-48 rounded-full bg-[#d8ece7] blur-3xl" />
          <div className="absolute bottom-0 left-10 h-32 w-32 rounded-full bg-[#ead6a6]/45 blur-3xl" />

          <div className="relative max-w-xl">
            <p className="section-eyebrow">AI Spend Visibility</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
              One calm place to track model usage and budget drift.
            </h1>
            <p className="mt-5 text-base leading-7 text-zinc-700">
              Sign in to review spend across OpenAI and Anthropic, watch model mix change over time, and keep monthly budgets from drifting quietly.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="soft-panel rounded-[24px] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Providers</p>
                <p className="mt-2 text-lg font-semibold text-zinc-900">OpenAI + Anthropic</p>
              </div>
              <div className="soft-panel rounded-[24px] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">View</p>
                <p className="mt-2 text-lg font-semibold text-zinc-900">Cost, tokens, budgets</p>
              </div>
              <div className="soft-panel rounded-[24px] p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Mode</p>
                <p className="mt-2 text-lg font-semibold text-zinc-900">Private self-hosted</p>
              </div>
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[34px] px-6 py-8 sm:px-8 sm:py-10">
          <p className="section-eyebrow">Access</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">Login</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-600">Continue to the secure sign-in page with your dashboard account.</p>

          <form action="/auth/cognito/login" method="post" className="mt-8">
            <button type="submit" className="rounded-full bg-[color:var(--foreground)] px-5 py-2.5 text-sm font-medium text-white shadow-sm">Sign In</button>
          </form>
          {error === "login_failed" && <p role="alert" className="mt-5 text-sm text-red-700">Sign-in could not be completed. Please try again.</p>}

          <Link href="/showcase" className="mt-6 inline-flex text-sm font-medium text-[color:var(--accent)] hover:underline">
            View public showcase
          </Link>
        </section>
      </div>
    </main>
  );
}
