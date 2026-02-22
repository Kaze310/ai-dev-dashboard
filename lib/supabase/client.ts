import { createBrowserClient } from "@supabase/ssr";

import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

export function createClient() {
  // 浏览器端 Supabase 客户端：用于登录页等需要直接发起 auth 请求的场景。
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
