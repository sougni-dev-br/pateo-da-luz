import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../buffet-analysis.service.js", () => ({
  KINDS: ["BUFFET", "COFFEE_BREAK", "EVENTO"],
  analiseDoBuffet: vi.fn(async () => ({ days: [], items: [], summary: {} })),
}));
vi.mock("../buffet-costs.service.js", () => ({ custoVisivel: vi.fn(async () => true) }));

import { analiseDoBuffet } from "../buffet-analysis.service.js";
import { buffetAnalysisRouter } from "../buffet-analysis.routes.js";
import { custoVisivel } from "../buffet-costs.service.js";
import { todayInSaoPaulo } from "../buffet-prints.routes.js";

const app = express();
app.use("/buffet-plates", buffetAnalysisRouter);

beforeEach(() => { vi.clearAllMocks(); vi.mocked(custoVisivel).mockResolvedValue(true); });

describe("GET /buffet-plates/analysis", () => {
  test("sem datas usa os últimos 30 dias até hoje (São Paulo) e o buffet do dia", async () => {
    const r = await request(app).get("/buffet-plates/analysis");
    expect(r.status).toBe(200);
    const [from, to, kind, ver] = vi.mocked(analiseDoBuffet).mock.calls[0];
    expect(to).toBe(todayInSaoPaulo());
    expect(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)).toBe(29 * 86_400_000);
    expect(kind).toBe("BUFFET");
    expect(ver).toBe(true);
  });

  test("repassa o período e o tipo pedidos, e se a pessoa pode ver custos", async () => {
    vi.mocked(custoVisivel).mockResolvedValue(false);
    await request(app).get("/buffet-plates/analysis?from=2026-11-01&to=2026-11-15&kind=EVENTO");
    expect(analiseDoBuffet).toHaveBeenCalledWith("2026-11-01", "2026-11-15", "EVENTO", false);
  });

  test.each([
    ["?from=2026-02-31", /data inválida/],
    ["?from=2026-11-20&to=2026-11-01", /depois da final/],
    ["?from=2025-01-01&to=2026-11-01", /no máximo 366 dias/],
    ["?kind=JANTAR", /opção inválida/],
  ])("recusa %s", async (qs, msg) => {
    const r = await request(app).get(`/buffet-plates/analysis${qs}`);
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(msg);
    expect(analiseDoBuffet).not.toHaveBeenCalled();
  });
});
