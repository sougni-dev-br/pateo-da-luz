import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cabecalhosParaReusar,
  corpoDaExportacao,
  escolherRegistro,
  ehPaginaDeLogin,
  mesesParaSincronizar,
  periodoDoMes,
  prefixoDoArquivo,
  redigirSegredos,
  urlDeDownloadValida,
  urlDoErpValida
} from "../src/logica.js";

describe("periodoDoMes", () => {
  test("mês corrente vai do dia 1 até ontem", () => {
    assert.deepEqual(periodoDoMes(2026, 10, "2026-10-19"), { inicio: "2026-10-01", fim: "2026-10-18" });
  });

  test("mês já fechado vai até o último dia", () => {
    assert.deepEqual(periodoDoMes(2026, 9, "2026-10-19"), { inicio: "2026-09-01", fim: "2026-09-30" });
  });

  test("no dia 1 o mês corrente ainda não tem dia fechado", () => {
    assert.equal(periodoDoMes(2026, 10, "2026-10-01"), null);
  });

  test("fevereiro de ano bissexto", () => {
    assert.deepEqual(periodoDoMes(2028, 2, "2028-03-10"), { inicio: "2028-02-01", fim: "2028-02-29" });
  });
});

describe("mesesParaSincronizar", () => {
  test("no meio do mês, só o mês corrente", () => {
    assert.deepEqual(mesesParaSincronizar("2026-10-19"), [{ ano: 2026, mes: 10 }]);
  });

  test("nos primeiros dias, também o mês anterior (a Keeta ajusta os últimos dias)", () => {
    assert.deepEqual(mesesParaSincronizar("2026-10-03"), [{ ano: 2026, mes: 9 }, { ano: 2026, mes: 10 }]);
  });

  test("na virada do ano o mês anterior é dezembro", () => {
    assert.deepEqual(mesesParaSincronizar("2027-01-02"), [{ ano: 2026, mes: 12 }, { ano: 2027, mes: 1 }]);
  });
});

describe("corpoDaExportacao", () => {
  test("monta o pedido igual ao que o portal envia, com o período e a loja", () => {
    const corpo = corpoDaExportacao({ shopId: 159408940, inicio: "2026-09-19", fim: "2026-10-18" });
    assert.deepEqual(corpo.form.measures, [
      "shop_income_no_low_price",
      "shop_shop_activity_subsidy_amt",
      "shop_profit_general",
      "shop_valid_order_num"
    ]);
    assert.deepEqual(corpo.form.dateFilters, [{ code: "dt", values: ["20260919~20261018"] }]);
    assert.deepEqual(corpo.form.filters, [[{ code: "shop_id", values: [159408940] }]]);
    assert.deepEqual(corpo.form.groupBy, ["shop_id"]);
    assert.equal(corpo.code, "shop_download_center_table");
    assert.equal(corpo.reportTab, "Dados do restaurante");
    assert.equal(corpo.downloadType, 1);
    assert.equal(corpo.downloadCategory, 1);
  });
});

describe("escolherRegistro", () => {
  const criadoEm = Date.parse("2026-10-19T12:00:00Z");
  const registro = (over) => ({
    taskId: "1", taskStatus: 2, s3Url: "https://exemplo/arquivo",
    fileName: "Dados_do_restaurante_20261001~20261018_s1@m.meeta.com_19_10_2026_09-00-00",
    ctime: criadoEm, ...over
  });
  const filtro = { inicio: "2026-10-01", fim: "2026-10-18", depoisDe: criadoEm - 1000 };

  test("acha o registro pronto do período pedido", () => {
    assert.equal(escolherRegistro([registro({})], filtro)?.taskId, "1");
  });

  test("ignora registro ainda em processamento (taskStatus diferente de 2)", () => {
    assert.equal(escolherRegistro([registro({ taskStatus: 1 })], filtro), null);
  });

  test("ignora arquivo de outro período, mesmo recente", () => {
    assert.equal(escolherRegistro([registro({ fileName: "Dados_do_restaurante_20260901~20260918_x" })], filtro), null);
  });

  test("ignora relatório antigo do mesmo período (de antes do pedido atual)", () => {
    assert.equal(escolherRegistro([registro({ ctime: criadoEm - 3_600_000 })], filtro), null);
  });

  test("ignora outro tipo de relatório (Dados do pedido)", () => {
    assert.equal(escolherRegistro([registro({ fileName: "Dados_do_pedido_20261001~20261018_x" })], filtro), null);
  });

  test("com dois prontos, fica com o mais novo", () => {
    const novo = registro({ taskId: "2", ctime: criadoEm + 5000 });
    assert.equal(escolherRegistro([registro({}), novo], filtro)?.taskId, "2");
  });

  test("registro sem link de download não serve", () => {
    assert.equal(escolherRegistro([registro({ s3Url: "" })], filtro), null);
  });
});

describe("prefixoDoArquivo", () => {
  test("segue o nome que o portal dá ao arquivo", () => {
    assert.equal(prefixoDoArquivo("2026-09-19", "2026-10-18"), "Dados_do_restaurante_20260919~20261018_");
  });
});

describe("cabecalhosParaReusar", () => {
  test("aproveita só os cabeçalhos do app (em minúsculas no Playwright) e restaura a grafia", () => {
    const capturados = {
      "m-appkey": "app", accountid: "1", shopid: "2", platform: "pc", "content-type": "application/json",
      cookie: "SEGREDO", "user-agent": "x", "content-length": "99", host: "h", origin: "o"
    };
    const reaproveitados = cabecalhosParaReusar(capturados);
    assert.equal(reaproveitados["M-APPKEY"], "app");
    assert.equal(reaproveitados.accountId, "1");
    assert.equal(reaproveitados.shopId, "2");
    assert.equal(reaproveitados["Content-Type"], "application/json");
    for (const proibido of ["cookie", "Cookie", "user-agent", "content-length", "host", "origin"]) {
      assert.equal(proibido in reaproveitados, false);
    }
  });
});

describe("urlDeDownloadValida", () => {
  test("aceita só https em domínio da Keeta", () => {
    assert.equal(urlDeDownloadValida("https://bucket.s3-fra01-eu.mykeeta.net/arquivo.xlsx?assinatura=1"), true);
    assert.equal(urlDeDownloadValida("https://merchant.mykeeta.com/x"), true);
  });

  test("recusa http, outro domínio, domínio parecido, IP interno e lixo", () => {
    for (const ruim of [
      "http://bucket.s3-fra01-eu.mykeeta.net/a",
      "https://evil.com/mykeeta.net",
      "https://mykeeta.net.evil.com/a",
      "https://notmykeeta.net/a",
      "https://169.254.169.254/latest/meta-data",
      "file:///c:/windows/win.ini",
      "nao e url",
      ""
    ]) {
      assert.equal(urlDeDownloadValida(ruim), false, ruim);
    }
  });
});

describe("urlDoErpValida", () => {
  test("exige https, exceto em máquina local (teste)", () => {
    assert.equal(urlDoErpValida("https://pateo-backend.onrender.com"), true);
    assert.equal(urlDoErpValida("http://localhost:3334"), true);
    assert.equal(urlDoErpValida("http://127.0.0.1:3334"), true);
    assert.equal(urlDoErpValida("http://pateo-backend.onrender.com"), false);
    assert.equal(urlDoErpValida("pateo-backend.onrender.com"), false);
  });
});

describe("redigirSegredos", () => {
  test("troca senha, e-mail e token por *** onde quer que apareçam", () => {
    const texto = "locator.fill: value 'Senha#123' for user@teste.com failed; token abc123def456";
    const limpo = redigirSegredos(texto, ["Senha#123", "user@teste.com", "abc123def456"]);
    assert.equal(limpo, "locator.fill: value '***' for *** failed; token ***");
  });

  test("ignora segredo vazio ou curto demais (não pode apagar o texto todo)", () => {
    assert.equal(redigirSegredos("texto normal", ["", undefined, null, "a"]), "texto normal");
  });

  test("segredo com caracteres de regex é tratado como texto", () => {
    assert.equal(redigirSegredos("a.*+?b e a.*+?b", ["a.*+?b"]), "*** e ***");
  });
});

describe("ehPaginaDeLogin", () => {
  test("reconhece o redirecionamento para o login", () => {
    assert.equal(ehPaginaDeLogin("https://merchant.mykeeta.com/pc/login?service=merchants"), true);
    assert.equal(ehPaginaDeLogin("https://merchant.mykeeta.com/m/web/app/bizdata#/dataDownload"), false);
  });
});
