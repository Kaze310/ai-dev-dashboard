import { handleSaveProviderKey } from "@/lib/provider-keys";
import { verifyAnthropicAdminKey } from "@/lib/providers/anthropic";

export async function POST(request: Request) {
  return handleSaveProviderKey(request, "anthropic", verifyAnthropicAdminKey);
}
