import { describe, expect, test } from "vitest";
import { calcularDecimoTerceiroSR, inicioDoDecimo } from "../decimo-terceiro-sr.js";
import { mesesSemVariavel } from "../decimo-terceiro-meses-faltando.js";
import { calcularVerbasOpcionais } from "../rescisao-verbas-opcionais.js";
import { conferirCamposFicha, entradaAntesDaAdmissao } from "../employee.routes.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("inicioDoDecimo", () => {
  test("sem recomeço, vale o início real", () => {
    expect(inicioDoDecimo(d("2022-02-07"), null)).toEqual(d("2022-02-07"));
    expect(inicioDoDecimo(d("2022-02-07"), undefined)).toEqual(d("2022-02-07"));
  });
  test("recomeço depois do início real vale; antes dele, não", () => {
    expect(inicioDoDecimo(d("2022-02-07"), d("2026-08-27"))).toEqual(d("2026-08-27"));
    expect(inicioDoDecimo(d("2026-09-01"), d("2026-08-27"))).toEqual(d("2026-09-01"));
  });
  test("sem início real, o recomeço serve", () => {
    expect(inicioDoDecimo(null, d("2026-08-27"))).toEqual(d("2026-08-27"));
    expect(inicioDoDecimo(null, null)).toBeNull();
  });
});

describe("13º de quem recomeçou depois de uma rescisão (set a dez)", () => {
  const base = {
    ano: 2026, salarioBase: 2600, inicio: inicioDoDecimo(d("2022-02-07"), d("2026-08-27")), desligamento: null,
    // Variáveis de janeiro a agosto (já pagas na rescisão) e de set/out: só set/out entram.
    variaveis: new Map([[1, 82.96], [2, 676.67], [8, 1037.67], [9, 1000], [10, 1000]]),
    mesesApurados: new Set([1, 2, 8, 9, 10]),
  };

  test("conta 4 avos (set a dez), 3 na 1ª parcela, e a média usa só set e out", () => {
    const r = calcularDecimoTerceiroSR(base)!;
    expect(r.avos).toBe(4);
    expect(r.avosParcela1).toBe(3);
    expect(r.mediaParcela1).toBe(1000);
    expect(r.parcela1).toBe(450); // (2600 + 1000) ÷ 12 × 3 ÷ 2
    expect(r.total).toBe(1200); // (2600 + 1000) ÷ 12 × 4
    expect(r.parcela2).toBe(750);
  });

  test("agosto não dá avo (só 5 dias depois de 27/08), então a variável de agosto não conta", () => {
    const semAgosto = calcularDecimoTerceiroSR({ ...base, variaveis: new Map([[9, 1000], [10, 1000]]) })!;
    expect(calcularDecimoTerceiroSR(base)!.parcela1).toBe(semAgosto.parcela1);
  });

  test("sem o recomeço, o mesmo cálculo contaria o ano inteiro (12 avos): é o que se quer evitar", () => {
    const inteiro = calcularDecimoTerceiroSR({ ...base, inicio: d("2022-02-07") })!;
    expect(inteiro.avos).toBe(12);
  });

  test("os meses que faltam também partem do recomeço", () => {
    const status = new Map([[9, "CLOSED"], [10, "CLOSED"], [11, "OPEN"]]);
    const r = mesesSemVariavel({
      ano: 2026, inicio: base.inicio, desligamento: null, ate: null, variaveis: new Map(), informados: new Set(),
      status, apurados: new Set([9, 10]),
    });
    expect(r).toEqual([{ mes: 9, motivo: "SEM_LANCAMENTO" }, { mes: 10, motivo: "SEM_LANCAMENTO" }, { mes: 11, motivo: "EM_ANDAMENTO" }]);
  });
});

describe("rescisão futura de quem recomeçou", () => {
  const base = { salarioBase: 2600, inicio: d("2022-02-07"), saida: d("2026-12-15"), feriasRegistradas: [] as Date[] };

  test("o 13º da rescisão parte do recomeço; férias e aviso seguem pelo início real", () => {
    const com = calcularVerbasOpcionais({ ...base, inicioDecimo: d("2026-08-27") })!;
    const sem = calcularVerbasOpcionais(base)!;
    expect(sem.decimoTerceiro.avos).toBe(12);
    expect(com.decimoTerceiro.avos).toBe(4);
    expect(com.decimoTerceiro.valor).toBe(866.67);
    expect(com.ferias).toEqual(sem.ferias);
    expect(com.aviso).toEqual(sem.aviso);
  });

  test("sem recomeço informado, nada muda", () => {
    expect(calcularVerbasOpcionais({ ...base, inicioDecimo: null })).toEqual(calcularVerbasOpcionais(base));
  });
});

describe("validação do início do 13º no cadastro", () => {
  test("aceita data real, vazio e ausente", () => {
    expect(conferirCamposFicha({ decimoTerceiroInicio: "2026-08-27" })).toBeNull();
    expect(conferirCamposFicha({ decimoTerceiroInicio: "" })).toBeNull();
    expect(conferirCamposFicha({ decimoTerceiroInicio: null })).toBeNull();
    expect(conferirCamposFicha({})).toBeNull();
  });
  test.each([["2026-02-31"], ["20260-01-01"], ["abc"], ["31/12/2026"], ["2026-13-01"], ["1999-01-01"]])("recusa %s", (v) => {
    expect(conferirCamposFicha({ decimoTerceiroInicio: v })).toBe("Início do 13º inválido.");
  });
});

describe("início do 13º antes da admissão", () => {
  test("é recusado com o nome do campo; igual ou depois passa; sem um dos dois passa", () => {
    expect(entradaAntesDaAdmissao(d("2022-01-01"), d("2022-02-07"), "Início do 13º")).toBe('"Início do 13º" não pode ser antes da admissão (07/02/2022).');
    expect(entradaAntesDaAdmissao(d("2022-02-07"), d("2022-02-07"), "Início do 13º")).toBeNull();
    expect(entradaAntesDaAdmissao(d("2026-08-27"), d("2022-02-07"), "Início do 13º")).toBeNull();
    expect(entradaAntesDaAdmissao(d("2026-08-27"), null, "Início do 13º")).toBeNull();
    expect(entradaAntesDaAdmissao(null, d("2022-02-07"), "Início do 13º")).toBeNull();
  });
  test("a mensagem da gorjeta continua a mesma", () => {
    expect(entradaAntesDaAdmissao(d("2022-01-01"), d("2022-02-07"))).toBe('"Entra na gorjeta em" não pode ser antes da admissão (07/02/2022).');
  });
});
