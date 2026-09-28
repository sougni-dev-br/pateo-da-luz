import { describe, expect, test } from "vitest";
import { lerTextoRescisao } from "../tip-trct.service.js";

// Mesmo formato do texto que a pdf-parse tira do TRCT da contabilidade (dados fictícios).
const TEXTO = `TERMO DE RESCISÃO DO CONTRATO DE TRABALHO
IDENTIFICAÇÃO DO TRABALHADOR
11 Nome
MARIA DE TESTE SILVA
10 PIS/PASEP
000.00000.00-0
SP 01.000-000 11111 - 00001 / SP 123.456.789-09
25 Data do Aviso Prévio 26 Data de Afastamento\t24 Data de Admissão
21/07/2026 08/09/2026 08/09/2026
R$ 0,00\tR$ 20,85 R$ 370,93
57 Gorjetas 58 Descanso Semanal
TOTAL DEDUÇÕES R$ 1.633,28
VALOR LÍQUIDO R$ 458,36
RELATÓRIO ANALÍTICO DO CÁLCULO DE RESCISÃO
21/07/2026 Data demissão:\t08/09/2026\tData aviso:\tData opção: 21/07/2026\tData admissão: 08/09/2026 Data projeção:
Motivo demissão: Resc. cont. exp. antec. pelo empregado Data pagamento: 17/09/2026
203 GORJETA 370,93 370,93
Totais: 2.091,64 1.633,28
Líquido rescisão: 458,36
`;

describe("leitura do termo de rescisão", () => {
  test("extrai gorjeta, datas e líquido", () => {
    expect(lerTextoRescisao(TEXTO)).toEqual({
      nome: "MARIA DE TESTE SILVA",
      cpfDigitos: "12345678909",
      admissao: "2026-07-21",
      afastamento: "2026-09-08",
      pagamento: "2026-09-17",
      gorjeta: 370.93,
      liquido: 458.36,
      totalBruto: 2091.64,
    });
  });

  test("gorjeta com milhar e sem a linha analítica", () => {
    const r = lerTextoRescisao("11 Nome\nFULANO\n203 GORJETA 1.234,56 1.234,56\nVALOR LÍQUIDO R$ 2.000,00");
    expect(r.gorjeta).toBe(1234.56);
    expect(r.liquido).toBe(2000);
  });

  test("sem rubrica de gorjeta devolve null (não inventa valor)", () => {
    expect(lerTextoRescisao("11 Nome\nFULANO\nVALOR LÍQUIDO R$ 10,00").gorjeta).toBeNull();
  });
});
