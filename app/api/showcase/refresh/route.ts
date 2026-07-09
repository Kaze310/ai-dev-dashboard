import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const configuredOwnerId = process.env.SHOWCASE_OWNER_USER_ID;
  if (configuredOwnerId && configuredOwnerId !== user.id) {
    return NextResponse.json({ error: "Showcase refresh is restricted to the owner" }, { status: 403 });
  }

  const { error } = await supabase.rpc("refresh_showcase_snapshot");
  if (error) {
    if (error.message.includes("showcase_snapshots") || error.message.includes("refresh_showcase_snapshot")) {
      return NextResponse.json(
        { error: "Apply migration 005_public_showcase_snapshots.sql before publishing the showcase." },
        { status: 503 },
      );
    }

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
