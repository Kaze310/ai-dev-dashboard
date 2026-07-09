import { handleSaveProviderKey } from "@/lib/provider-keys";
import { verifyOpenAIAdminKey } from "@/lib/providers/openai";

export async function POST(request: Request) {
  return handleSaveProviderKey(request, "openai", verifyOpenAIAdminKey);
}
