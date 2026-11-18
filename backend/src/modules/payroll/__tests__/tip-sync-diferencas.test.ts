import { describe, expect, test } from "vitest";
import { diferencasDoSync, foraDoRateio, type PessoaDoCadastro, type ParticipanteDoPeriodo, type PessoaDoPeriodo } from "../tip-sync-diferencas.js";

const p = (id: string, over: Partial<PessoaDoCadastro> = {}): PessoaDoCadastro => ({ id, nome: `Pessoa ${id}`, funcao: "Atendimento", pontos: 3.5, tipoGorjeta: "PONTOS", ...over });
const ex = (employeeId: string, over: Partial<ParticipanteDoPeriodo> = {}): ParticipanteDoPeriodo => ({ employeeId, basePoints: 3.5, functionName: "Atendimento", foraDaGorjeta: false, vales: 0, ...over });
const base = { elegiveis: [], soSalario: [], emTeste: [], existentes: [] };

describe("diferencasDoSync", () => {
  test("cadastro igual ao período: nenhuma diferença", () => {
    expect(diferencasDoSync({ ...base, elegiveis: [p("a")], existentes: [ex("a")] })).toEqual([]);
  });
  test("quem participa e ainda não está no período será incluído", () => {
    const r = diferencasDoSync({ ...base, elegiveis: [p("a")] });
    expect(r).toMatchObject([{ employeeId: "a", tipo: "INCLUIR" }]);
    expect(r[0].detalhe).toContain("3,5 pts");
  });
  test("mudou os pontos e a função no cadastro", () => {
    const r = diferencasDoSync({ ...base, elegiveis: [p("a", { pontos: 3, funcao: "Pia 2" })], existentes: [ex("a")] });
    expect(r.map((x) => x.tipo)).toEqual(["PONTOS", "FUNCAO"]);
    expect(r[0].detalhe).toBe("pontos-base 3,5 → 3");
    expect(r[1].detalhe).toBe("função Atendimento → Pia 2");
  });
  test("só salário que passou a participar", () => {
    const r = diferencasDoSync({ ...base, elegiveis: [p("a")], existentes: [ex("a", { foraDaGorjeta: true, basePoints: 0, functionName: null })] });
    expect(r.map((x) => x.tipo)).toEqual(["PASSA_A_PARTICIPAR"]);
  });
  test("cota fixa: inclusão e passagem de só salário falam em cota fixa, sem pontos", () => {
    const fixa = p("f", { tipoGorjeta: "FIXO", pontos: 0 });
    const incluir = diferencasDoSync({ ...base, elegiveis: [fixa] });
    expect(incluir[0].detalhe).toBe("entra no rateio com cota fixa");
    const passa = diferencasDoSync({ ...base, elegiveis: [fixa], existentes: [ex("f", { foraDaGorjeta: true })] });
    expect(passa[0].detalhe).toContain("cota fixa");
    expect(diferencasDoSync({ ...base, elegiveis: [fixa], existentes: [ex("f")] })).toEqual([]);
  });
  test("sem registro que não participa entra só pelo salário; quem já está não aparece", () => {
    const r = diferencasDoSync({ ...base, soSalario: [p("a"), p("b")], existentes: [ex("b", { foraDaGorjeta: true })] });
    expect(r).toMatchObject([{ employeeId: "a", tipo: "INCLUIR", detalhe: "entra só pelo salário (fora do rateio)" }]);
  });
  test("sem registro que deixou de participar sai do rateio e fica só pelo salário", () => {
    const r = diferencasDoSync({ ...base, soSalario: [p("a")], emTeste: [p("a")], existentes: [ex("a")] });
    expect(r.map((x) => `${x.employeeId}:${x.tipo}`)).toEqual(["a:SAI_DO_RATEIO"]);
  });
  test("CLT em teste sai do rateio e do período (a sincronização o remove), a não ser que tenha vale", () => {
    const sem = diferencasDoSync({ ...base, emTeste: [p("c")], existentes: [ex("c")] });
    expect(sem.map((x) => x.tipo)).toEqual(["SAI_DO_RATEIO", "SAI_DO_PERIODO"]);
    const com = diferencasDoSync({ ...base, emTeste: [p("c")], existentes: [ex("c", { vales: 2 })] });
    expect(com.map((x) => x.tipo)).toEqual(["SAI_DO_RATEIO"]);
  });
  test("só salário que perdeu o direito sai do período, a não ser que tenha vale", () => {
    const sem = diferencasDoSync({ ...base, existentes: [ex("x", { foraDaGorjeta: true })] });
    expect(sem).toMatchObject([{ employeeId: "x", tipo: "SAI_DO_PERIODO" }]);
    expect(diferencasDoSync({ ...base, existentes: [ex("x", { foraDaGorjeta: true, vales: 1 })] })).toEqual([]);
  });
});

describe("foraDoRateio", () => {
  const fim = new Date("2026-11-25T00:00:00.000Z");
  const pessoa = (id: string, over: Partial<PessoaDoPeriodo> = {}): PessoaDoPeriodo => ({
    id, nome: `P ${id}`, modality: "CLT", participaGorjeta: true, inicioGorjeta: new Date("2026-01-01T00:00:00.000Z"), pontos: 3.5, tipoGorjeta: "PONTOS", ...over,
  });
  test("quem recebe normalmente não aparece", () => {
    expect(foraDoRateio([pessoa("a")], fim, new Set())).toEqual([]);
  });
  test("motivos: desmarcado, sem data, data futura e sem função", () => {
    const r = foraDoRateio([
      pessoa("a", { participaGorjeta: false }),
      pessoa("b", { inicioGorjeta: null }),
      pessoa("c", { inicioGorjeta: new Date("2026-12-01T00:00:00.000Z") }),
      pessoa("d", { pontos: 0 }),
    ], fim, new Set());
    expect(r.map((x) => x.motivo)).toEqual([
      expect.stringContaining("desmarcado"),
      expect.stringContaining("Sem a data"),
      expect.stringContaining("01/12/2026"),
      expect.stringContaining("sem função"),
    ]);
  });
  test("indica quem recebe só o salário e ordena por nome", () => {
    const r = foraDoRateio([pessoa("z", { participaGorjeta: false }), pessoa("a", { participaGorjeta: false })], fim, new Set(["z"]));
    expect(r.map((x) => x.employeeId)).toEqual(["a", "z"]);
    expect(r[1].soSalario).toBe(true);
    expect(r[1].motivo).toContain("Recebe só o salário");
  });
  test("cota fixa sem pontos não é 'sem função'", () => {
    expect(foraDoRateio([pessoa("a", { tipoGorjeta: "FIXO", pontos: 0 })], fim, new Set())).toEqual([]);
  });
});
