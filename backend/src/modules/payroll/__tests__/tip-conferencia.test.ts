import { describe, expect, test } from "vitest";
import { type ExtratoEmpresa, type PessoaApurada, conferir, esconderTeto, montarFolhaLiquidos } from "../tip-conferencia.js";
import { lerTextoExtrato } from "../rh-extract.service.js";

const FREI = "46.878.233/0001-92";
const pessoa = (over: Partial<PessoaApurada>): PessoaApurada => ({
  employeeId: "x", nome: "X", semRegistro: false, noPeriodo: true, pagoNaRescisao: false,
  gorjetaLiquida: 0, totalAPagar: 0, cnpjEmpresa: FREI, pix: null, ...over,
});
const extrato = (linhas: ExtratoEmpresa["linhas"]): ExtratoEmpresa => ({ empresa: "PATEO FREI CANECA", cnpj: FREI, linhas });
const linha = (over: Partial<ExtratoEmpresa["linhas"][number]>) => ({
  employeeId: null, nome: "", liquido: 0, gorjeta: null, adiantamento: null, situacao: "Trabalhando", ...over,
});

describe("conferência do extrato (agosto/2026)", () => {
  const apuracao = [
    pessoa({ employeeId: "analia", nome: "Analia", gorjetaLiquida: 723.07 }), // 767,87 − 44,80
    pessoa({ employeeId: "eli", nome: "Elioenai", gorjetaLiquida: 2594.17 }),
    pessoa({ employeeId: "taissa", nome: "Taissa", gorjetaLiquida: 280.17 }),
    pessoa({ employeeId: "viviane", nome: "Viviane", gorjetaLiquida: 370.93, pagoNaRescisao: true }),
    pessoa({ employeeId: "janete", nome: "Janete", gorjetaLiquida: 1037.67, semRegistro: true, totalAPagar: 1037.67, cnpjEmpresa: null }),
  ];
  const combinados = new Map([["eli", 5200]]);
  const ex = extrato([
    linha({ employeeId: "analia", nome: "ANALIA", liquido: 1526, gorjeta: 723.07, adiantamento: 860 }),
    linha({ employeeId: "eli", nome: "ELIOENAI", liquido: 3030, gorjeta: 1328, adiantamento: 1468.8 }),
    linha({ employeeId: "michele", nome: "MICHELE", liquido: 380, adiantamento: 980 }),
    linha({ nome: "FULANO FORA DO CADASTRO", liquido: 500, gorjeta: 100 }),
  ]);

  test("bate pela gorjeta líquida; salário combinado não é divergência", () => {
    const r = conferir(apuracao, [ex], new Map(), combinados);
    const st = Object.fromEntries(r.map((l) => [l.chave, l.status]));
    expect(st.analia).toBe("OK");
    expect(st.eli).toBe("SALARIO_COMBINADO");
    expect(st.taissa).toBe("FALTA_NO_EXTRATO");
    expect(st.michele).toBe("NAO_PARTICIPA");
    expect(st["extrato:FULANO FORA DO CADASTRO"]).toBe("SO_NO_EXTRATO");
    expect(st.viviane).toBeUndefined(); // paga na rescisão
    expect(st.janete).toBeUndefined();  // sem registro não vai à contabilidade
  });

  test("divergência aceita guarda a justificativa", () => {
    const r = conferir(apuracao, [ex], new Map([["taissa", "Admitida em 18/08, registro só em setembro"]]));
    const t = r.find((l) => l.chave === "taissa")!;
    expect(t.status).toBe("ACEITA");
    expect(t.justificativa).toMatch(/setembro/);
  });

  test("empresa sem extrato carregado não acusa a pessoa como faltando", () => {
    const r = conferir([pessoa({ employeeId: "jodeni", gorjetaLiquida: 1297.08, cnpjEmpresa: "05.520.881/0001-95" })], [ex], new Map());
    expect(r.find((l) => l.chave === "jodeni")!.status).toBe("SEM_EXTRATO_DA_EMPRESA");
  });

  test("folha de líquidos: extrato, salário combinado e sem registro", () => {
    const f = montarFolhaLiquidos(apuracao, [ex], combinados);
    const valor = Object.fromEntries(f.map((l) => [l.employeeId ?? l.nome, l.valor]));
    expect(valor.analia).toBe(1526);
    expect(valor.eli).toBe(6325.37); // (5.200 − 1.468,80) + 2.594,17
    expect(valor.michele).toBe(380);
    expect(valor.janete).toBe(1037.67);
    expect(f.find((l) => l.employeeId === "eli")!.origem).toBe("SALARIO_COMBINADO");
  });

  test("salário combinado vale mesmo para quem não está na apuração da gorjeta", () => {
    const f = montarFolhaLiquidos([], [ex], combinados);
    expect(f.find((l) => l.employeeId === "eli")).toMatchObject({ origem: "SALARIO_COMBINADO", valor: 3731.2 }); // 5.200 − 1.468,80
    const c = conferir([], [ex], new Map(), combinados);
    expect(c.find((l) => l.chave === "eli")!.status).toBe("SALARIO_COMBINADO");
  });

  test("vínculo pelo nome fica pendente e não usa PIX nem salário combinado do cadastro até confirmar", () => {
    const pelaNome = extrato([linha({ employeeId: "eli", nome: "ELIOENAI", liquido: 3030, gorjeta: 1328, adiantamento: 1468.8, vinculo: "NOME" })]);
    const ap = [pessoa({ employeeId: "eli", nome: "Elioenai", gorjetaLiquida: 2594.17, pix: "chave-do-cadastro" })];
    expect(conferir(ap, [pelaNome], new Map([["eli", "tanto faz"]]), combinados)[0].status).toBe("VINCULO_A_CONFIRMAR");
    const f = montarFolhaLiquidos(ap, [pelaNome], combinados)[0];
    expect(f).toMatchObject({ origem: "EXTRATO", valor: 3030, pix: null });
    expect(f.aviso).toMatch(/confirme/i);

    const confirmado = extrato([linha({ employeeId: "eli", nome: "ELIOENAI", liquido: 3030, gorjeta: 1328, adiantamento: 1468.8, vinculo: "CONFIRMADO" })]);
    expect(conferir(ap, [confirmado], new Map(), combinados)[0].status).toBe("SALARIO_COMBINADO");
    expect(montarFolhaLiquidos(ap, [confirmado], combinados)[0]).toMatchObject({ valor: 6325.37, pix: "chave-do-cadastro" });
  });

  test("demitido com líquido zero no extrato não entra na folha", () => {
    const f = montarFolhaLiquidos([], [extrato([linha({ employeeId: "eliezer", nome: "ELIEZER", liquido: 0, situacao: "Demitido" })])]);
    expect(f).toEqual([]);
  });
});

describe("leitura do extrato mensal", () => {
  const TEXTO = `EXTRATO MENSAL
08/2026
PATEO FREI CANECA BAR E FORNERIA LTDA
46.878.233/0001-92
20 FULANO DE TAL\tEmpr.: 01/03/2025\tAdm:\t123.456.789-09\tTrabalhando CPF:\tSituação:
1 HORAS NORMAIS 981 1.468,80 D\tP\t3.672,00\t220,00 DESC.ADIANT.SALARIAL 1.468,80
203 GORJETA 998 501,50 D\tP\t1.328,00\t1.328,00 I.N.S.S. 10,03
ND: 1 Proventos: 5.000,30 Líquido:\tDescontos: 1.970,30 Informativa: 400,00 Informativa Dedutora: 0 3.030,00
NF: 1`;

  test("lê gorjeta, líquido, adiantamento e situação", () => {
    const [f] = lerTextoExtrato(TEXTO).funcionarios;
    expect(f).toMatchObject({ nome: "FULANO DE TAL", gorjeta: 1328, liquido: 3030, adiantamento: 1468.8, situacao: "Trabalhando" });
  });
});

describe("apelido na conferência", () => {
  test("cada linha com vínculo leva o apelido do mapa; sem vínculo, null", () => {
    const r = conferir(
      [pessoa({ employeeId: "a", nome: "Ana Paula", gorjetaLiquida: 10 })],
      [extrato([linha({ employeeId: "a", nome: "ANA PAULA", gorjeta: 10 }), linha({ nome: "SEM CADASTRO", gorjeta: 5 })])],
      new Map(), new Map(), new Map([["a", "Aninha"]]),
    );
    expect(r.map((l) => [l.chave, l.apelido])).toEqual([["a", "Aninha"], ["extrato:SEM CADASTRO", null]]);
  });
});

describe("folha de líquidos: sem registro com adiantamento salarial", () => {
  test("a composição mostra o adiantamento quando houve; sem ele, fica como antes", () => {
    const f = montarFolhaLiquidos([
      pessoa({ employeeId: "com", nome: "Com", semRegistro: true, totalAPagar: 1592.66, adiantamentoSalarial: 880, cnpjEmpresa: null }),
      pessoa({ employeeId: "sem", nome: "Sem", semRegistro: true, totalAPagar: 2472.66, adiantamentoSalarial: 0, cnpjEmpresa: null }),
      pessoa({ employeeId: "antigo", nome: "Antigo", semRegistro: true, totalAPagar: 100, cnpjEmpresa: null }),
    ], []);
    const por = Object.fromEntries(f.map((l) => [l.employeeId, l]));
    expect(por.com).toMatchObject({ valor: 1592.66, composicao: "salário − adiantamento + gorjeta − vales" });
    expect(por.sem.composicao).toBe("salário + gorjeta − vales");
    expect(por.antigo.composicao).toBe("salário + gorjeta − vales");
  });
});

describe("conferência pela gorjeta informada (teto do IR)", () => {
  const eli = (over: Partial<PessoaApurada> = {}) =>
    pessoa({ employeeId: "eli", nome: "Elioenai", gorjetaLiquida: 2223.54, gorjetaInformada: 1328, peloTeto: true, ...over });
  const combinados = new Map([["eli", 5200]]);
  const comGorjeta = (gorjeta: number) => extrato([linha({ employeeId: "eli", nome: "ELIOENAI", liquido: 3030, gorjeta, adiantamento: 1468.8 })]);

  test("extrato com a gorjeta informada: OK, comparando com ela (não com a do rateio)", () => {
    const [l] = conferir([eli()], [comGorjeta(1328)], new Map(), combinados);
    expect(l).toMatchObject({ status: "OK", apuracao: 1328, extrato: 1328, diferenca: 0, peloTeto: true });
  });

  test("contabilidade lançou outro valor: diverge, mesmo com salário combinado", () => {
    const [l] = conferir([eli()], [comGorjeta(2223.54)], new Map(), combinados);
    expect(l).toMatchObject({ status: "DIVERGE", apuracao: 1328, diferenca: 895.54 });
  });

  test("divergência pelo teto pode ser aceita com justificativa", () => {
    const [l] = conferir([eli()], [comGorjeta(1300)], new Map([["eli", "Contabilidade arredondou"]]), combinados);
    expect(l).toMatchObject({ status: "ACEITA", justificativa: "Contabilidade arredondou" });
  });

  test("sem teto continua como antes: salário combinado não confere a gorjeta", () => {
    const [l] = conferir([eli({ peloTeto: false, gorjetaInformada: 2223.54 })], [comGorjeta(1328)], new Map(), combinados);
    expect(l.status).toBe("SALARIO_COMBINADO");
    expect(l.apuracao).toBe(2223.54);
  });

  test("faltando no extrato: a apuração mostra a gorjeta informada", () => {
    const [l] = conferir([eli()], [extrato([])], new Map(), combinados);
    expect(l).toMatchObject({ status: "FALTA_NO_EXTRATO", apuracao: 1328, peloTeto: true });
  });

  test("a folha de líquidos continua pagando a gorjeta real", () => {
    const f = montarFolhaLiquidos([eli()], [comGorjeta(1328)], combinados);
    expect(f[0]).toMatchObject({ origem: "SALARIO_COMBINADO", valor: 5954.74 }); // 5.200 − 1.468,80 + 2.223,54
  });
});

describe("conferência sem permissão de ver Funcionários", () => {
  test("a linha pelo teto mantém o status, sem o valor da apuração nem a diferença", () => {
    const linhas = conferir(
      [pessoa({ employeeId: "eli", nome: "Elioenai", gorjetaLiquida: 2223.54, gorjetaInformada: 1328, peloTeto: true }),
        pessoa({ employeeId: "ana", nome: "Ana", gorjetaLiquida: 500 })],
      [extrato([linha({ employeeId: "eli", nome: "ELIOENAI", gorjeta: 1300 }), linha({ employeeId: "ana", nome: "ANA", gorjeta: 500 })])],
      new Map());
    const sem = esconderTeto(linhas, false);
    // Auditoria 01/10: o extrato de quem é pelo teto também sai (com "OK", ele É o teto − salário).
    expect(sem.find((l) => l.chave === "eli")).toMatchObject({ status: "DIVERGE", apuracao: null, diferenca: null, extrato: null, peloTeto: true });
    expect(sem.find((l) => l.chave === "ana")).toMatchObject({ status: "OK", apuracao: 500, diferenca: 0 });
    expect(JSON.stringify(sem)).not.toContain("1328");
    expect(JSON.stringify(sem)).not.toContain("1300");
    expect(esconderTeto(linhas, true)).toEqual(linhas);
  });
});
