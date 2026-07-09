"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type AccountActionsProps = {
  email: string;
};

export function AccountActions({ email }: AccountActionsProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError("");

    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError(signOutError.message);
      setIsSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="rounded-[24px] border border-white/70 bg-white/72 px-5 py-3 shadow-sm backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Signed in as</p>
        <p className="mt-1 text-sm font-medium text-zinc-900">{email}</p>
      </div>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="inline-flex items-center rounded-full border border-[color:var(--line)] bg-white/75 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60"
      >
        {isSigningOut ? "Signing out…" : "Log out"}
      </button>

      {error ? <p className="basis-full text-right text-xs text-red-700" role="alert">{error}</p> : null}
    </div>
  );
}
