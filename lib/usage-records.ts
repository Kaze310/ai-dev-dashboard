export type ProviderRef = {
  name: string;
};

export type UsageRecordRow = {
  id: string;
  date: string;
  model: string;
  input_tokens: number | string | null;
  output_tokens: number | string | null;
  cost_cents: number | string | null;
  provider: ProviderRef | ProviderRef[] | null;
};

export function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function formatDate(dateString: string) {
  return new Date(`${dateString}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
  });
}

export function formatCost(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getProviderName(provider: UsageRecordRow["provider"]) {
  if (!provider) {
    return "unknown";
  }

  if (Array.isArray(provider)) {
    return provider[0]?.name ?? "unknown";
  }

  return provider.name;
}
