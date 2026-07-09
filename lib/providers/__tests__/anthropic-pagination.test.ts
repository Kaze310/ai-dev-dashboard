import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAnthropicUsage } from "../anthropic";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function usageBucket(date: string, model: string, inputTokens: number) {
  return {
    starting_at: `${date}T00:00:00Z`,
    results: [{ model, input_tokens: inputTokens, output_tokens: 1 }],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Anthropic usage pagination", () => {
  it("follows next_page via the page param and merges all pages", async () => {
    const requestedUrls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requestedUrls.push(url);

        if (url.includes("/usage_report/messages")) {
          const isSecondPage = url.includes("page=cursor-2");
          if (!isSecondPage) {
            return jsonResponse({
              data: [usageBucket("2026-06-01", "claude-sonnet-4-5", 100)],
              has_more: true,
              next_page: "cursor-2",
            });
          }
          return jsonResponse({
            data: [usageBucket("2026-06-02", "claude-sonnet-4-5", 200)],
            has_more: false,
            next_page: null,
          });
        }

        // cost_report:空结果即可。
        return jsonResponse({ data: [], has_more: false, next_page: null });
      }),
    );

    const records = await fetchAnthropicUsage("sk-ant-admin-test", "2026-06-01", "2026-06-05");

    // 两页数据都被合并。
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.date).sort()).toEqual(["2026-06-01", "2026-06-02"]);

    // 第二次 usage 请求必须带 page=cursor-2(此前用的 after_id 永远翻不了页)。
    const usageUrls = requestedUrls.filter((u) => u.includes("/usage_report/messages"));
    expect(usageUrls).toHaveLength(2);
    expect(usageUrls[1]).toContain("page=cursor-2");
    expect(usageUrls[1]).not.toContain("after_id");
  });

  it("stops when has_more is false", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [usageBucket("2026-06-01", "claude-opus-4-6", 10)], has_more: false }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchAnthropicUsage("sk-ant-admin-test", "2026-06-01", "2026-06-02");

    // usage 1 次 + cost 1 次,没有多余翻页。
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
