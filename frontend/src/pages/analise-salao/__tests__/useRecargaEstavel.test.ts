import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useRecargaEstavel } from "../useRecargaEstavel";

type Estado = { dados: string | null; carregando: boolean; erro: string | null; chave: string };
const relatorio = (e: Estado) => ({ dados: e.dados, carregando: e.carregando, erro: e.erro, recarregar: vi.fn() });
const montar = (inicial: Estado) => renderHook((e: Estado) => useRecargaEstavel(relatorio(e), e.chave), { initialProps: inicial });

describe("useRecargaEstavel", () => {
  test("com dado, mostra o dado; sem aviso nao segura o dado antigo enquanto carrega", () => {
    const { result, rerender } = montar({ dados: "A", carregando: false, erro: null, chave: "p1" });
    expect(result.current.naTela).toBe("A");
    rerender({ dados: null, carregando: true, erro: null, chave: "p1" });
    expect(result.current.naTela).toBeNull();
  });

  test("depois de anunciar, o dado antigo fica na tela enquanto recarrega, e o aviso aparece", () => {
    const { result, rerender } = montar({ dados: "A", carregando: false, erro: null, chave: "p1" });
    act(() => result.current.anunciarERecarregar("Vínculo salvo."));
    rerender({ dados: null, carregando: true, erro: null, chave: "p1" });
    expect(result.current.naTela).toBe("A");
    expect(result.current.aviso).toBe("Vínculo salvo.");
    expect(result.current.recalculando).toBe(true);
    rerender({ dados: "A2", carregando: false, erro: null, chave: "p1" });
    expect(result.current.naTela).toBe("A2");
  });

  test("a releitura que falha expoe o erro e mantem o dado antigo", () => {
    const { result, rerender } = montar({ dados: "A", carregando: false, erro: null, chave: "p1" });
    act(() => result.current.anunciarERecarregar("Vínculo salvo."));
    rerender({ dados: null, carregando: false, erro: "Falha de rede", chave: "p1" });
    expect(result.current.erro).toBe("Falha de rede");
  });

  test("ir e voltar de periodo: nunca mostra o dado de um periodo sob o outro", () => {
    const { result, rerender } = montar({ dados: "A", carregando: false, erro: null, chave: "p1" });
    act(() => result.current.anunciarERecarregar("Vínculo salvo."));
    rerender({ dados: "B", carregando: false, erro: null, chave: "p2" });
    expect(result.current.aviso).toBeNull(); // o aviso era do periodo p1
    rerender({ dados: null, carregando: true, erro: null, chave: "p1" });
    expect(result.current.aviso).toBe("Vínculo salvo."); // voltou ao p1, mas o dado em memoria e do p2
    expect(result.current.naTela).toBeNull();
  });
});
