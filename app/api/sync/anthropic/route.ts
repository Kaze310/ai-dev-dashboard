import { fetchAnthropicUsage } from "@/lib/providers/anthropic";
import { handleProviderSync } from "@/lib/sync";

export async function POST(request: Request) {
  return handleProviderSync(request, "anthropic", fetchAnthropicUsage);
}
