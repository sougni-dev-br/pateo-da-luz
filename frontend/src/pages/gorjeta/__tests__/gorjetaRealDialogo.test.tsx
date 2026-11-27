import { fireEvent, render as renderRaw, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import type { TipComputedParticipant } from "../../../api/client";
import { SessionContext, type SessionContextValue } from "../../../context/SessionContext";
import { HideValuesProvider } from "../../../design-system";
import { DialogoGorjetaReal } from "../GorjetaReal";

const SESSAO = { user: null, setUser: () => undefined, hideSensitiveValues: false, toggleSensitiveValues: () => undefined, canAccessSection: () => true, hasPermission: () => true } as unknown as SessionContextValue;
const render = (ui: ReactElement) => renderRaw(<SessionContext.Provider value={SESSAO}><HideValuesProvider>{ui}</HideValuesProvider></SessionContext.Provider>);
const limpo = (t: string | null) => (t ?? "").replace(/\s/g, "");

type Real = TipComputedParticipant["gorjetaReal"];
const pessoa = (over: Partial<TipComputedParticipant> = {}) =>
  ({ employeeName: "Pessoa Ficticia", gorjetaCalculada: 300, points: 2.5, gorjetaReal: null, ...over }) as TipComputedParticipant;

const MOTIVO_OK = "acertada à parte com a gerência";

function abrir(p = pessoa(), onSalvar = vi.fn().mockResolvedValue(undefined), onFechar = vi.fn()) {
  render(<DialogoGorjetaReal participante={p} onSalvar={onSalvar} onFechar={onFechar} />);
  return {
    onSalvar,
    onFechar,
    campo: screen.getByLabelText("Gorjeta real") as HTMLInputElement,
    motivo: screen.getByPlaceholderText(/Ex\.: gorjeta acertada/) as HTMLTextAreaElement,
  };
}

describe("Diálogo de gorjeta real", () => {
  test("mostra o nome, a gorjeta calculada, os pontos e começa com o valor calculado", () => {
    const { campo } = abrir();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Pessoa Ficticia" })).toBeTruthy();
    expect(limpo(document.body.textContent)).toContain("Calculadapelosistema:R$300,00(2,5pts)");
    expect(campo.value).toBe("300,00");
    expect(screen.queryByText("Voltar à calculada")).toBeNull();
  });

  test("com ajuste existente começa pelo valor real, mostra quem ajustou e oferece voltar à calculada", () => {
    const { campo, motivo } = abrir(pessoa({ gorjetaReal: { valor: 250, motivo: "combinado", por: "Fulana Teste", em: null } as unknown as Real }));
    expect(campo.value).toBe("250,00");
    expect(limpo(document.body.textContent)).toContain("Ajusteatual:R$250,00·FulanaTeste");
    expect(motivo.value).toBe("combinado");
    expect(screen.getByText("Voltar à calculada")).toBeTruthy();
  });

  test("a máscara formata o que se digita e a diferença para menos vira \"Sobram\" no livre", () => {
    const { campo } = abrir();
    fireEvent.change(campo, { target: { value: "25000" } });
    expect(campo.value).toBe("250,00");
    expect(limpo(document.body.textContent)).toContain("SobramR$50,00nolivreparadistribuir.");
  });

  test("valor real acima do calculado mostra \"Faltam\" e avisa que sai do saldo", () => {
    const { campo } = abrir();
    fireEvent.change(campo, { target: { value: "35000" } });
    expect(limpo(document.body.textContent)).toContain("FaltamR$50,00nolivreparadistribuir(saidosaldo).");
  });

  test("valor igual ao calculado não mostra diferença", () => {
    abrir();
    expect(limpo(document.body.textContent)).not.toContain("Sobram");
    expect(limpo(document.body.textContent)).not.toContain("Faltam");
  });

  test("campo vazio ou só texto: pede a gorjeta real e não grava", () => {
    const { campo, motivo, onSalvar } = abrir();
    fireEvent.change(motivo, { target: { value: MOTIVO_OK } });
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    expect(screen.getByText("Digite a gorjeta real (R$).")).toBeTruthy();
    fireEvent.change(campo, { target: { value: "abc" } });
    expect(campo.value).toBe("");
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    expect(onSalvar).not.toHaveBeenCalled();
  });

  test("motivo curto: diz quantas letras faltam e não grava; ao digitar o aviso some", () => {
    const { motivo, onSalvar } = abrir();
    fireEvent.change(motivo, { target: { value: "curto" } });
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    expect(screen.getByText("Explique em pelo menos 10 letras (faltam 5).")).toBeTruthy();
    expect(onSalvar).not.toHaveBeenCalled();
    fireEvent.change(motivo, { target: { value: "curto demais" } });
    expect(screen.queryByText(/Explique em pelo menos/)).toBeNull();
  });

  test("motivo só com espaços não conta", () => {
    const { motivo, onSalvar } = abrir();
    fireEvent.change(motivo, { target: { value: "            " } });
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    expect(screen.getByText("Explique em pelo menos 10 letras (faltam 10).")).toBeTruthy();
    expect(onSalvar).not.toHaveBeenCalled();
  });

  test("gravar chama onSalvar com o número e o motivo sem espaços nas pontas, e fecha", async () => {
    const { campo, motivo, onSalvar, onFechar } = abrir();
    fireEvent.change(campo, { target: { value: "123456" } });
    fireEvent.change(motivo, { target: { value: `  ${MOTIVO_OK}  ` } });
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(onSalvar).toHaveBeenCalledWith(1234.56, MOTIVO_OK);
  });

  test("zero é um valor válido (gorjeta real zerada)", async () => {
    const { campo, motivo, onSalvar } = abrir();
    fireEvent.change(campo, { target: { value: "0" } });
    fireEvent.change(motivo, { target: { value: MOTIVO_OK } });
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith(0, MOTIVO_OK));
  });

  test("voltar à calculada envia null (exige motivo, mas não exige valor)", async () => {
    const { campo, motivo, onSalvar } = abrir(pessoa({ gorjetaReal: { valor: 250, motivo: "x", por: null, em: null } as unknown as Real }));
    fireEvent.change(campo, { target: { value: "" } });
    fireEvent.change(motivo, { target: { value: "x" } });
    fireEvent.click(screen.getByText("Voltar à calculada"));
    expect(onSalvar).not.toHaveBeenCalled();
    fireEvent.change(motivo, { target: { value: "voltando ao cálculo do sistema" } });
    fireEvent.click(screen.getByText("Voltar à calculada"));
    await waitFor(() => expect(onSalvar).toHaveBeenCalledWith(null, "voltando ao cálculo do sistema"));
  });

  test("erro da API aparece, o diálogo continua aberto e dá para tentar de novo", async () => {
    const onSalvar = vi.fn().mockRejectedValueOnce(new Error("Período fechado.")).mockResolvedValueOnce(undefined);
    const { motivo, onFechar } = abrir(pessoa(), onSalvar);
    fireEvent.change(motivo, { target: { value: MOTIVO_OK } });
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    expect(await screen.findByText("Período fechado.")).toBeTruthy();
    expect(onFechar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
    expect(onSalvar).toHaveBeenCalledTimes(2);
  });

  test("enquanto grava, os botões ficam desabilitados e Esc não fecha", async () => {
    let liberar: () => void = () => undefined;
    const onSalvar = vi.fn(() => new Promise<void>((ok) => { liberar = ok; }));
    const { motivo, onFechar } = abrir(pessoa(), onSalvar);
    fireEvent.change(motivo, { target: { value: MOTIVO_OK } });
    fireEvent.click(screen.getByText("Gravar gorjeta real"));
    const gravando = await screen.findByText("Gravando…");
    expect((gravando.closest("button") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Cancelar").closest("button") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFechar).not.toHaveBeenCalled();
    liberar();
    await waitFor(() => expect(onFechar).toHaveBeenCalledTimes(1));
  });

  test("cancelar e Esc fecham sem gravar", () => {
    const { onSalvar, onFechar } = abrir();
    fireEvent.click(screen.getByText("Cancelar"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onFechar).toHaveBeenCalledTimes(2);
    expect(onSalvar).not.toHaveBeenCalled();
  });
});
