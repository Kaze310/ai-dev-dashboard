import { fetchOpenAIUsage } from "@/lib/providers/openai";
import { handleProviderSync } from "@/lib/sync";

export async function POST(request: Request) {
  return handleProviderSync(request, "openai", fetchOpenAIUsage);
}
