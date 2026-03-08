"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  // 用 useMemo 确保同一次页面生命周期里复用同一个客户端实例。
  const supabase = useMemo(() => createClient(), []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setMessage("");

    // 邮箱+密码登录，成功后跳回首页。
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMessage(error.message);
      setIsLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  };

  const handleSignUp = async () => {
    setIsLoading(true);
    setMessage("");

    // 注册后让邮件确认链接回到 /auth/callback，以便交换 session。
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setMessage(error.message);
      setIsLoading(false);
      return;
    }

    setMessage("Sign-up successful. Check your email for the confirmation link.");
    setIsLoading(false);
  };

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
          <p className="mt-3 text-sm leading-6 text-zinc-600">Use email and password to sign in or create an account.</p>

          <form onSubmit={handleSignIn} className="mt-8 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-zinc-800">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="w-full rounded-2xl border border-[color:var(--line)] bg-white/85 px-4 py-3 text-zinc-900 shadow-sm outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent-soft)]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-sm font-medium text-zinc-800">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                className="w-full rounded-2xl border border-[color:var(--line)] bg-white/85 px-4 py-3 text-zinc-900 shadow-sm outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent-soft)]"
              />
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="rounded-full bg-[color:var(--foreground)] px-5 py-2.5 text-sm font-medium text-white shadow-sm disabled:opacity-50"
              >
                Sign In
              </button>

              <button
                type="button"
                onClick={handleSignUp}
                disabled={isLoading}
                className="rounded-full border border-[color:var(--line)] bg-white/75 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-sm disabled:opacity-50"
              >
                Sign Up
              </button>
            </div>
          </form>

          {message ? <p className="mt-5 text-sm text-zinc-700">{message}</p> : null}
        </section>
      </div>
    </main>
  );
}
