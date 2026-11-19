import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { TipTrocaExtrato } from "../../../api/client";
import { ResultadoTrocaExtrato } from "../ResultadoTrocaExtrato";

const limpo = (t: string | null) => (t ?? "").replace(/\s/g, "");
const troca = (over: Partial<TipTrocaExtrato> = {}): TipTrocaExtrato => ({
  motivo: null, diferencas: [], contasAPagar: [], gorjetaMudou: false, avisoContasAPagar: null, ...over,
});
const mostrar = (t: TipTrocaExtrato, avisos: string[] = [], onFechar = vi.fn()) => {
  render(<ResultadoTrocaExtrato empresa="Empresa Teste" troca={t} avisos={avisos} onFechar={onFechar} />);
  return onFechar;
};

describe("Resultado da troca de extrato", () => {
  test("título com a empresa; o motivo só aparece quando informado", () => {
    const { unmount } = render(<ResultadoTrocaExtrato empresa="Empresa Teste" troca={troca()} avisos={[]} onFechar={vi.fn()} />);
    expect(screen.getByRole("region", { name: "Extrato trocado: Empresa Teste" }).textContent).toContain("Extrato de Empresa Teste trocado");
    expect(screen.queryByText(/ — /)).toBeNull();
    unmount();
    mostrar(troca({ motivo: "extrato corrigido pela contabilidade" }));
    expect(screen.getByText(/trocado — extrato corrigido pela contabilidade/)).toBeTruthy();
  });

  test("sem diferenças: diz que nada mudou e não mostra lista", () => {
    mostrar(troca());
    expect(screen.getByText("Nenhuma diferença de líquido ou gorjeta em relação ao extrato anterior.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Diferenças do extrato novo" })).toBeNull();
  });

  test("cada diferença mostra nome, situação e antes → depois de líquido e gorjeta", () => {
    mostrar(troca({
      diferencas: [
        { employeeId: "e1", nome: "Pessoa Um", situacao: "MUDOU", liquidoAntes: 1000, liquidoDepois: 1200.5, gorjetaAntes: 100, gorjetaDepois: 90 },
        { employeeId: null, nome: "Pessoa Dois", situacao: "ENTROU", liquidoAntes: null, liquidoDepois: 500, gorjetaAntes: null, gorjetaDepois: null },
        { employeeId: "e3", nome: "Pessoa Tres", situacao: "SAIU", liquidoAntes: 300, liquidoDepois: null, gorjetaAntes: 0, gorjetaDepois: null },
      ],
    }));
    const itens = within(screen.getByRole("list", { name: "Diferenças do extrato novo" })).getAllByRole("listitem");
    expect(itens).toHaveLength(3);
    expect(limpo(itens[0].textContent)).toBe("PessoaUm(mudou)·líquidoR$1.000,00→R$1.200,50·gorjetaR$100,00→R$90,00");
    expect(limpo(itens[1].textContent)).toBe("PessoaDois(entrou)·líquido—→R$500,00·gorjeta—→—");
    expect(limpo(itens[2].textContent)).toBe("PessoaTres(saiu)·líquidoR$300,00→—·gorjetaR$0,00→—");
  });

  test("salários diferentes no Contas a Pagar aparecem num alerta com o aviso e o título", () => {
    mostrar(troca({
      avisoContasAPagar: "Atualize os salários no Retorno do RH.",
      contasAPagar: [
        { employeeId: "e1", nome: "Pessoa Um", noContasAPagar: 1000, extratoNovo: 1100, titulo: "Folha 09/2026" },
        { employeeId: "e2", nome: "Pessoa Dois", noContasAPagar: null, extratoNovo: 800, titulo: null },
      ],
    }));
    const alerta = screen.getByRole("alert");
    expect(alerta.textContent).toContain("Atualize os salários no Retorno do RH.");
    const itens = within(within(alerta).getByRole("list", { name: "Salários diferentes no Contas a Pagar" })).getAllByRole("listitem");
    expect(limpo(itens[0].textContent)).toBe(limpo('Pessoa Um: no Contas a Pagar R$ 1.000,00, no extrato novo R$ 1.100,00 (no título "Folha 09/2026")'));
    expect(limpo(itens[1].textContent)).toBe(limpo("Pessoa Dois: no Contas a Pagar —, no extrato novo R$ 800,00"));
  });

  test("sem salários diferentes: não há alerta", () => {
    mostrar(troca());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("avisos da troca só aparecem quando existem", () => {
    const { unmount } = render(<ResultadoTrocaExtrato empresa="E" troca={troca()} avisos={[]} onFechar={vi.fn()} />);
    expect(screen.queryByRole("list", { name: "Avisos da troca" })).toBeNull();
    unmount();
    mostrar(troca(), ["Pessoa sem cadastro no extrato", "Outro aviso"]);
    expect(within(screen.getByRole("list", { name: "Avisos da troca" })).getAllByRole("listitem")).toHaveLength(2);
  });

  test("fechar chama onFechar", () => {
    const onFechar = mostrar(troca());
    fireEvent.click(screen.getByRole("button", { name: "Fechar o resultado da troca" }));
    expect(onFechar).toHaveBeenCalledTimes(1);
  });
});
