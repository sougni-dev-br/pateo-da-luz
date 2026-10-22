import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// A Financial API da 99 devolve rate limit como HTTP 200 + errno 10005. Sem tratar isso, o erro virava
// "erro financeiro" genérico e nunca era repetido. O retry é por página: uma página que falha não refaz as anteriores.
vi.mock("../../../../../config/database.js", () => ({
  prisma: {
    noventaNoveCredential: { findFirst: vi.fn(async () => ({ clientId: "id-ficticio", clientSecret: "segredo-ficticio" })) }
  }
}));

import { getBillDetails, NoventaNoveApiException } from "../noventa-nove-financial-api.js";
import { RETRY_INTERATIVO } from "../noventa-nove-retry.js";

type RespostaFake = { status?: number; corpo: unknown };

const json = ({ status = 200, corpo }: RespostaFake): Response =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

const pagina = (pageNo: number, totalPage: number, itens: object[]) => ({
  errno: 0,
  data: { data: itens, total_page: totalPage, page_no: pageNo, total_num: itens.length, page_size: 200 }
});
const rateLimit = { errno: 10005, errmsg: "rate limit" };

// Roteia por URL; as respostas de /getShopBillDetail saem na ordem dada (a última se repete).
function instalarFetch(respostasDoBill: RespostaFake[]) {
  const paginasPedidas: number[] = [];
  let i = 0;
  const fetchFake = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/signIn")) return json({ corpo: { accessToken: "token-ficticio", expiresIn: 21600 } });
    const body = JSON.parse(String(init?.body ?? "{}"));
    paginasPedidas.push(body.page_no);
    const resposta = respostasDoBill[Math.min(i, respostasDoBill.length - 1)];
    i += 1;
    return json(resposta);
  });
  vi.stubGlobal("fetch", fetchFake);
  return { fetchFake, paginasPedidas };
}

const periodo = { appShopId: "LOJA-FICTICIA", startDate: "20261001", endDate: "20261031" };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Financial API — retry por página", () => {
  test("errno 10005 com HTTP 200 vira rate limit, espera a janela e a segunda tentativa passa", async () => {
    const { paginasPedidas } = instalarFetch([
      { corpo: rateLimit },
      { corpo: pagina(1, 1, [{ orderId: "p1", orderType: 1 }]) }
    ]);

    const promessa = getBillDetails(periodo);
    await vi.advanceTimersByTimeAsync(25_000);

    await expect(promessa).resolves.toEqual([{ orderId: "p1", orderType: 1 }]);
    expect(paginasPedidas).toEqual([1, 1]);
  });

  test("só a página que falhou é refeita; as anteriores não são pedidas de novo", async () => {
    const { paginasPedidas } = instalarFetch([
      { corpo: pagina(1, 2, [{ orderId: "a", orderType: 1 }]) },
      { status: 503, corpo: {} },
      { corpo: pagina(2, 2, [{ orderId: "b", orderType: 1 }]) }
    ]);

    const promessa = getBillDetails(periodo);
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promessa).resolves.toEqual([
      { orderId: "a", orderType: 1 },
      { orderId: "b", orderType: 1 }
    ]);
    expect(paginasPedidas).toEqual([1, 2, 2]);
  });

  test("política interativa: duas falhas seguidas e o erro sobe, sem esperar a janela inteira", async () => {
    const { paginasPedidas } = instalarFetch([{ corpo: rateLimit }]);

    const promessa = getBillDetails(periodo, RETRY_INTERATIVO);
    const resultado = expect(promessa).rejects.toBeInstanceOf(NoventaNoveApiException);
    await vi.advanceTimersByTimeAsync(RETRY_INTERATIVO.esperaMaxMs + 100);

    await resultado;
    expect(paginasPedidas).toHaveLength(RETRY_INTERATIVO.tentativas);
  });

  test("erro de negócio (intervalo maior que 31 dias) sobe na hora, sem repetir", async () => {
    const { paginasPedidas } = instalarFetch([{ corpo: { errno: 110005, errmsg: "range" } }]);

    await expect(getBillDetails(periodo)).rejects.toBeInstanceOf(NoventaNoveApiException);
    expect(paginasPedidas).toHaveLength(1);
  });
});
