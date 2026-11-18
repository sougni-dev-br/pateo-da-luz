import { FORM_VAZIO, type FormGuia } from "./formularioGuia";

// Quando a sessão expira (30 min sem uso) o sistema recarrega a página para o login e o que estava digitado no modal de
// lançamento se perderia. Nesse momento o modal guarda um rascunho na aba (sessionStorage: some ao fechar a aba, não vai
// a lugar nenhum) e, depois do login, oferece restaurá-lo. Só conveniência: sem armazenamento, o modal funciona igual.
const CHAVE = "impostos:rascunho:v1";
const VALIDADE_MS = 4 * 60 * 60 * 1000;

export type RascunhoDaGuia = { salvoEm: number; usuarioId: string; form: FormGuia };

// O rascunho é de quem estava digitando: se outra pessoa entrar na mesma aba, não o vê (e ele é apagado).
export function guardarRascunho(form: FormGuia, usuarioId: string = "", agora: number = Date.now()): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ salvoEm: agora, usuarioId, form } satisfies RascunhoDaGuia));
  } catch { /* sem armazenamento: não guarda */ }
}

export function apagarRascunho(): void {
  try { sessionStorage.removeItem(CHAVE); } catch { /* nada a apagar */ }
}

// Devolve o rascunho se ele existe, está dentro da validade e tem a forma esperada; senão apaga e devolve null.
export function lerRascunho(usuarioId: string = "", agora: number = Date.now()): RascunhoDaGuia | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const lido = JSON.parse(bruto) as Partial<RascunhoDaGuia> | null;
    const form = lido?.form as Partial<FormGuia> | undefined;
    const valido = typeof lido?.salvoEm === "number" && agora - lido.salvoEm <= VALIDADE_MS && (lido.usuarioId ?? "") === usuarioId
      && form != null && typeof form.documentType === "string" && Array.isArray(form.linhas);
    if (!valido) { apagarRascunho(); return null; }
    // Campos que não existiam quando o rascunho foi guardado ficam com o valor vazio, nunca indefinidos.
    return { salvoEm: lido!.salvoEm as number, usuarioId, form: { ...FORM_VAZIO, ...(form as FormGuia) } };
  } catch {
    apagarRascunho();
    return null;
  }
}
