import { describe, expect, test } from "vitest";
import { avaliarRecibo, ehReciboDeFerias, lerReciboDeFerias } from "../ferias-recibo.js";

// Texto como o pdf-parse entrega o "Aviso e Recibo de Férias" da contabilidade (valores soltos dos rótulos).
// Pessoa, empresa e valores fictícios; as contas fecham: 5.333,68 de proventos − 700,00 de descontos = 4.633,68.
type Opcoes = { nome?: string; empresa?: string; periodos?: string; liquido?: string; datas?: [string, string] };
const recibo = (o: Opcoes = {}) => {
  const nome = o.nome ?? "ANA PAULA EXEMPLO SOUZA";
  const empresa = o.empresa ?? "EMPRESA EXEMPLO COMERCIO LTDA";
  const liquido = o.liquido ?? "4.633,68";
  return [
    "0,00",
    "AVISO E RECIBO DE FÉRIAS",
    "Faltas não justificadas:",
    "Salário Base:",
    "TOTAL BASE CALCULO: 4.000,00",
    "Férias:",
    o.periodos ?? "01/02/2025 A 31/01/2026 02/12/2026 A 31/12/2026 = 30 Dias",
    "AVISO PRÉVIO DE FÉRIAS",
    "NOTIFICAÇÃO",
    "Nome do empregado Número Carteira Profissional Série",
    "PERÍODOS",
    "De Aquisição De Gozo das Férias De Abono",
    nome,
    "TROCO FÉRIAS: 0,35 P",
    `Recebi da firma ${empresa}, estabelecida a Avenida DAS FLORES, 100 em SAO PAULO a importância de`,
    `R$ ${liquido}(quatro mil reais ) que me é paga adiantadamente por motivo das minhas férias regulares.`,
    "TOTAL DOS PROVENTOS: 5.333,68 P",
    "TOTAL DOS DESCONTOS: 700,00 D",
    `TOTAL LIQUIDO: ${liquido} P`,
    `Pelo presente comunicamos-lhe que ficará à sua disposição a importância líquida de R$ ${liquido} (quatro mil reais ) a ser paga adiantadamente.`,
    "CIENTE,",
    "RECIBO DE FÉRIAS",
    ...(o.datas ?? ["30/10/2026", "30/11/2026"]).map((d) => `Data: ${d}`),
    `${nome} ${empresa}`,
    nome,
    "",
  ].join("\n");
};

describe("ehReciboDeFerias", () => {
  test("reconhece o aviso e recibo, e não outro documento", () => {
    expect(ehReciboDeFerias(recibo())).toBe(true);
    expect(ehReciboDeFerias("EXTRATO MENSAL DO RH")).toBe(false);
  });
});

describe("lerReciboDeFerias", () => {
  test("lê nome, empresa, períodos, datas e totais", () => {
    expect(lerReciboDeFerias(recibo())).toEqual({
      nome: "ANA PAULA EXEMPLO SOUZA", empresa: "EMPRESA EXEMPLO COMERCIO LTDA",
      aquisitivoInicio: "2025-02-01", aquisitivoFim: "2026-01-31", gozoInicio: "2026-12-02", gozoFim: "2026-12-31", dias: 30,
      temOutroPeriodo: false, avisoEm: "2026-10-30", pagamentoEm: "2026-11-30",
      proventos: 5333.68, descontos: 700, liquido: 4633.68,
    });
  });

  test("com uma só data, ela vale como aviso e como pagamento", () => {
    const r = lerReciboDeFerias(recibo({ datas: ["30/11/2026", "30/11/2026"] }).replace("Data: 30/11/2026\n", ""));
    expect(r.avisoEm).toBe("2026-11-30");
    expect(r.pagamentoEm).toBe("2026-11-30");
  });

  test("sem a linha do nome com a empresa, usa o nome que mais se repete", () => {
    const sem = recibo().replace("ANA PAULA EXEMPLO SOUZA EMPRESA EXEMPLO COMERCIO LTDA\n", "");
    expect(lerReciboDeFerias(sem).nome).toBe("ANA PAULA EXEMPLO SOUZA");
  });

  test("detecta um terceiro período (abono ou licença) na linha dos períodos", () => {
    const r = lerReciboDeFerias(recibo({ periodos: "01/02/2025 A 31/01/2026 02/12/2026 A 21/12/2026 = 20 Dias 22/12/2026 A 31/12/2026 = 10 Dias" }));
    expect(r.dias).toBe(20);
    expect(r.temOutroPeriodo).toBe(true);
  });

  test("texto que não é um recibo volta com tudo nulo", () => {
    expect(lerReciboDeFerias("qualquer coisa")).toMatchObject({ nome: null, gozoInicio: null, liquido: null });
  });
});

describe("avaliarRecibo", () => {
  test("recibo íntegro: sem recusa e sem aviso", () => {
    const texto = recibo();
    expect(avaliarRecibo(lerReciboDeFerias(texto), texto)).toEqual({ recusa: null, avisos: [] });
  });

  test("recusa o que não dá para lançar", () => {
    expect(avaliarRecibo(lerReciboDeFerias("AVISO E RECIBO DE FÉRIAS")).recusa).toMatch(/nome/);
    expect(avaliarRecibo({ ...lerReciboDeFerias(recibo()), liquido: null }).recusa).toMatch(/valor líquido/);
    expect(avaliarRecibo({ ...lerReciboDeFerias(recibo()), gozoInicio: null }).recusa).toMatch(/período de gozo/);
    expect(avaliarRecibo({ ...lerReciboDeFerias(recibo()), gozoFim: "2026-11-01" }).recusa).toMatch(/termina antes/);
  });

  test("avisa quando as contas não fecham, quando há outro período e quando falta a data do pagamento", () => {
    const base = lerReciboDeFerias(recibo());
    expect(avaliarRecibo({ ...base, descontos: 650 }).avisos.join(" ")).toMatch(/não fecham/);
    expect(avaliarRecibo({ ...base, temOutroPeriodo: true }).avisos.join(" ")).toMatch(/abono ou licença/);
    expect(avaliarRecibo({ ...base, pagamentoEm: null }).avisos.join(" ")).toMatch(/2 dias antes/);
  });

  test("avisa quando o líquido da tabela difere do da frase", () => {
    const texto = recibo().replace("importância líquida de R$ 4.633,68", "importância líquida de R$ 4.000,00");
    expect(avaliarRecibo(lerReciboDeFerias(texto), texto).avisos.join(" ")).toMatch(/difere/);
  });
});
