type AccountActionsProps = { email: string };

export function AccountActions({ email }: AccountActionsProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="rounded-[24px] border border-white/70 bg-white/72 px-5 py-3 shadow-sm backdrop-blur">
        <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Signed in as</p>
        <p className="mt-1 text-sm font-medium text-zinc-900">{email}</p>
      </div>

      <form action="/auth/cognito/logout" method="post">
        <button type="submit" className="inline-flex items-center rounded-full border border-[color:var(--line)] bg-white/75 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-sm hover:-translate-y-0.5">Log out</button>
      </form>
    </div>
  );
}
