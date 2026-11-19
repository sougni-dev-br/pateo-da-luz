import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { TipComputation, TipComputedParticipant, TipRegrasPessoa } from "../../../api/client";
import { RegrasPessoa, temRegraPropria } from "../RegrasPessoa";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const SEM_REGRAS: TipRegrasPessoa = {
  descontaFalta: null, descontaAtestado: null, descontaFerias: null, descontaOutros: null, proporcionalEntrada: null, descontaAfastamento: null,
};

const comp = (over: Partial<TipComputation> = {}) =>
  ({ descontaFalta: true, descontaAtestado: false, descontaFerias: true, descontaOutros: false, proporcionalEntrada: true, ...over }) as TipComputation;
const pessoa = () =>
  ({ employeeName: "Pessoa Ficticia", diasComputados: 20, diasReferencia: 26, pontosApurados: 1.5, basePoints: 2 }) as TipComputedParticipant;

function abrir(regras: TipRegrasPessoa = SEM_REGRAS, over: Partial<Parameters<typeof RegrasPessoa>[0]> = {}) {
  const props = { comp: comp(), p: pessoa(), regras, disabled: false, onChange: vi.fn(), onFechar: vi.fn(), ...over };
  render(<RegrasPessoa {...props} />);
  return props;
}
const selectDe = (rotulo: string) => screen.getByText(rotulo).closest("label")!.querySelector("select") as HTMLSelectElement;

describe("temRegraPropria", () => {
  test("falso sem nenhuma regra e verdadeiro com qualquer uma definida (inclusive Não)", () => {
    expect(temRegraPropria(SEM_REGRAS)).toBe(false);
    expect(temRegraPropria({ ...SEM_REGRAS, descontaFalta: false })).toBe(true);
    expect(temRegraPropria({ ...SEM_REGRAS, descontaAfastamento: true })).toBe(true);
  });
});

describe("Regras de presença da pessoa", () => {
  test("mostra o nome e o resumo de dias e pontos", () => {
    abrir();
    expect(screen.getByRole("dialog", { name: "Regras de presença de Pessoa Ficticia" })).toBeTruthy();
    expect(screen.getByText(/20 dias de 26 → 1,5 pts de 2/)).toBeTruthy();
  });

  test("a opção Padrão mostra a regra do período (sim/não)", () => {
    abrir();
    expect(selectDe("Descontar faltas").options[0].textContent).toBe("Padrão (sim)");
    expect(selectDe("Descontar atestados").options[0].textContent).toBe("Padrão (não)");
    expect(selectDe("Descontar outros dias").options[0].textContent).toBe("Padrão (não)");
  });

  test("afastamento: sem definição no período o padrão é descontar", () => {
    abrir(SEM_REGRAS, { comp: comp({ descontaAfastamento: undefined }) });
    expect(selectDe("Descontar afastamento não remunerado").options[0].textContent).toBe("Padrão (sim)");
  });

  test("regra própria aparece selecionada", () => {
    abrir({ ...SEM_REGRAS, descontaFalta: false, descontaAtestado: true });
    expect(selectDe("Descontar faltas").value).toBe("nao");
    expect(selectDe("Descontar atestados").value).toBe("sim");
    expect(selectDe("Descontar férias").value).toBe("");
  });

  test("escolher Sim ou Não chama onChange só com aquela regra alterada", () => {
    const { onChange } = abrir({ ...SEM_REGRAS, descontaFerias: true });
    fireEvent.change(selectDe("Descontar faltas"), { target: { value: "nao" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...SEM_REGRAS, descontaFerias: true, descontaFalta: false });
    fireEvent.change(selectDe("Admitido no período: proporcional"), { target: { value: "sim" } });
    expect(onChange).toHaveBeenLastCalledWith({ ...SEM_REGRAS, descontaFerias: true, proporcionalEntrada: true });
  });

  test("escolher Padrão volta a regra para null", () => {
    const { onChange } = abrir({ ...SEM_REGRAS, descontaFalta: true });
    fireEvent.change(selectDe("Descontar faltas"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith({ ...SEM_REGRAS, descontaFalta: null });
  });

  test("desabilitado (período fechado / sem permissão): todos os campos e o voltar ao padrão ficam travados", () => {
    abrir({ ...SEM_REGRAS, descontaFalta: true }, { disabled: true });
    for (const s of screen.getAllByRole("combobox")) expect((s as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByText("voltar ao padrão") as HTMLButtonElement).disabled).toBe(true);
  });

  test("\"voltar ao padrão\" só aparece com regra própria e zera todas", () => {
    const sem = abrir();
    expect(screen.queryByText("voltar ao padrão")).toBeNull();
    expect(sem.onChange).not.toHaveBeenCalled();
  });

  test("voltar ao padrão envia todas as regras null", () => {
    const { onChange } = abrir({ ...SEM_REGRAS, descontaFalta: false, descontaOutros: true });
    fireEvent.click(screen.getByText("voltar ao padrão"));
    expect(onChange).toHaveBeenCalledWith(SEM_REGRAS);
  });

  test("fechar pelo botão, por Esc e por clique fora chamam onFechar", () => {
    const { onFechar } = abrir();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(document.body);
    expect(onFechar).toHaveBeenCalledTimes(3);
  });

  test("clique dentro da caixa não fecha", () => {
    const { onFechar } = abrir();
    fireEvent.mouseDown(screen.getByText("Descontar faltas"));
    expect(onFechar).not.toHaveBeenCalled();
  });
});
