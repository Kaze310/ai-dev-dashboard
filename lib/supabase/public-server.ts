import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { supabaseAnonKey, supabaseUrl } from "./config";

export function createPublicServerClient() {
  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
