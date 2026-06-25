export { toNumber } from "@/lib/normalize";

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

export function formatDate(dateString: string) {
  return new Date(`${dateString}T00:00:00.000Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
  });
}

export function formatCost(cents: number) {
  // 非 0 但不足一分钱的花费显示 <$0.01,而不是误导性的 $0.00。
  // 总额仍按真实 numeric 累加,这里只是展示层处理。
  const dollars = cents / 100;
  if (dollars > 0 && dollars < 0.01) {
    return "<$0.01";
  }
  return `$${dollars.toFixed(2)}`;
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
