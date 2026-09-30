import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ScheduleDayMeta, ScheduleDayType, ScheduleEmployee } from "../../../api/client";
import { MARCAS_OCORRENCIA, TIPOS_OCORRENCIA, proximaOcorrencia } from "../marcas";
import { SoOcorrencias } from "../SoOcorrencias";

// Seção "Fora da escala — só ocorrências": sem turno, com férias, ciclo próprio.
const dias: ScheduleDayMeta[] = [1, 2, 3].map((day) => ({ day, dow: (day + 1) % 7, isSunday: false, isHoliday: false, holidayName: null }));
const rita: ScheduleEmployee = {
  id: "r", firstName: "Rita", lastName: "Souza", displayName: null, sector: "Salão", subgroup: null, position: null,
  shiftStart: null, shiftEnd: null, scheduleRegime: "SEIS_POR_UM", admissionDate: null, terminationDate: null, isActive: true,
  gender: "FEMININO", holidayCompBalance: 0, somenteOcorrencias: true,
};

function montar(marks = new Map<string, ScheduleDayType>(), over: Partial<Parameters<typeof SoOcorrencias>[0]> = {}) {
  const onMarcar = vi.fn();
  render(
    <SoOcorrencias employees={[rita]} days={dias} year={2026} month={9} marks={marks} isFerias={() => false} canEdit
      onMarcar={onMarcar} descartadas={0} nameCol={172} countCol={52} cell={34} compacto={false} {...over} />,
  );
  return onMarcar;
}

// Por padrão a seção começa recolhida; os testes da tela abrem (lembrado no navegador).
beforeEach(() => window.localStorage.setItem("escala-so-ocorrencias-aberta", "1"));

describe("recolher", () => {
  test("recolhida mostra só o título com o resumo; o clique abre e lembra", () => {
    window.localStorage.removeItem("escala-so-ocorrencias-aberta");
    montar(new Map([["r|2", "FALTA" as ScheduleDayType]]));
    const botao = screen.getByRole("button", { name: /Fora da escala — só ocorrências/ });
    expect(botao).toHaveAttribute("aria-expanded", "false");
    expect(botao.textContent).toContain("1 pessoa(s) · 1 ocorrência(s) no mês");
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(botao);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(window.localStorage.getItem("escala-so-ocorrencias-aberta")).toBe("1");
  });
});

describe("tipos permitidos", () => {
  test("só falta, atestado, férias e as três folgas — nunca turno ou evento", () => {
    expect([...TIPOS_OCORRENCIA].sort()).toEqual(["ATESTADO", "FALTA", "FERIAS", "FOLGA", "FOLGA_BANCO_HORAS", "FOLGA_FERIADO"]);
    expect(MARCAS_OCORRENCIA.map((m) => m.tipo)).not.toContain("TURNO");
  });

  test("ciclo sem pincel: — → F → X → AT → —; turno antigo limpa; pincel aplica e limpa", () => {
    expect(proximaOcorrencia(undefined, null)).toBe("FOLGA");
    expect(proximaOcorrencia("FOLGA", null)).toBe("FALTA");
    expect(proximaOcorrencia("FALTA", null)).toBe("ATESTADO");
    expect(proximaOcorrencia("ATESTADO", null)).toBeNull();
    expect(proximaOcorrencia("TURNO", null)).toBeNull();
    expect(proximaOcorrencia("FOLGA", "FERIAS")).toBe("FERIAS");
    expect(proximaOcorrencia("FERIAS", "FERIAS")).toBeNull();
  });
});

describe("seção na tela", () => {
  test("título, legenda e paleta sem turno", () => {
    montar();
    expect(screen.getByRole("heading", { name: /^Fora da escala — só ocorrências/ })).toBeTruthy();
    expect(screen.getByText(/valem para a gorjeta e o VT/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Turno/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Férias/ })).toBeTruthy();
  });

  test("clique cicla; com o pincel de férias, aplica férias", () => {
    const onMarcar = montar(new Map([["r|2", "FALTA"]]));
    fireEvent.click(screen.getByLabelText("Rita Souza, dia 1"));
    expect(onMarcar).toHaveBeenLastCalledWith("r", 1, "FOLGA");
    fireEvent.click(screen.getByLabelText("Rita Souza, dia 2: Falta"));
    expect(onMarcar).toHaveBeenLastCalledWith("r", 2, "ATESTADO");
    fireEvent.click(screen.getByRole("button", { name: /Férias/ }));
    fireEvent.click(screen.getByLabelText("Rita Souza, dia 3"));
    expect(onMarcar).toHaveBeenLastCalledWith("r", 3, "FERIAS");
  });

  test("sem permissão de editar não tem paleta nem clique", () => {
    const onMarcar = montar(new Map(), { canEdit: false });
    expect(screen.queryByText("Marcar com:")).toBeNull();
    fireEvent.click(screen.getByLabelText("Rita Souza, dia 1"));
    expect(onMarcar).not.toHaveBeenCalled();
  });

  test("avisa quando descartou turno antigo", () => {
    montar(new Map(), { descartadas: 2 });
    expect(screen.getByRole("status").textContent).toMatch(/2 marcação\(ões\) de turno/);
  });
});

describe("teclado", () => {
  test("célula editável entra no Tab e Enter/Espaço marcam como o clique", () => {
    const onMarcar = montar(new Map([["r|2", "FALTA"]]));
    const dia1 = screen.getByRole("button", { name: "Rita Souza, dia 1" });
    expect(dia1).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(dia1, { key: "Enter" });
    expect(onMarcar).toHaveBeenLastCalledWith("r", 1, "FOLGA");
    fireEvent.keyDown(screen.getByRole("button", { name: "Rita Souza, dia 2: Falta" }), { key: " " });
    expect(onMarcar).toHaveBeenLastCalledWith("r", 2, "ATESTADO");
    fireEvent.keyDown(dia1, { key: "a" });
    expect(onMarcar).toHaveBeenCalledTimes(2);
  });

  test("sem permissão de editar, a célula não é botão nem entra no Tab", () => {
    montar(new Map(), { canEdit: false });
    expect(screen.queryByRole("button", { name: /Rita Souza, dia/ })).toBeNull();
    expect(screen.getByLabelText("Rita Souza, dia 1")).not.toHaveAttribute("tabindex");
  });

  test("férias da Folha: célula \"Fér\" sem Tab e sem teclado", () => {
    const onMarcar = montar(new Map(), { isFerias: (_id, dia) => dia === 2 });
    const fer = screen.getByLabelText("Rita Souza, dia 2: Férias (Folha)");
    expect(fer.textContent).toBe("Fér");
    expect(fer).not.toHaveAttribute("tabindex");
    fireEvent.keyDown(fer, { key: "Enter" });
    expect(onMarcar).not.toHaveBeenCalled();
  });
});

describe("contagem Ocor.", () => {
  test("não conta marca antiga em dia que mostra \"Fér\" (férias da Folha)", () => {
    // Marca de falta no dia 2 ficou da escala, mas a Folha diz férias nesse dia: a célula mostra "Fér".
    montar(new Map<string, ScheduleDayType>([["r|1", "FOLGA"], ["r|2", "FALTA"]]), { isFerias: (_id, dia) => dia === 2 });
    const linha = screen.getByText("Rita Souza").closest("tr")!;
    expect(linha.querySelector('td[title="Ocorrências marcadas no mês"]')!.textContent).toBe("1");
    expect(screen.getByRole("button", { name: /Fora da escala/ }).textContent).toContain("1 ocorrência(s) no mês");
  });
});
