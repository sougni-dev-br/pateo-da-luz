import type { WasteEntry } from "../../api/client";

// Recortes da lista de lançamentos. Vêm dos cartões de análise (clicar em "Vencido" mostra só os vencidos)
// e da busca por texto; a lista já está na tela, então o recorte é local.

export type FiltroDaLista = {
  motivo: string | null;
  setor: string | null;
  item: { chave: string; rotulo: string } | null;
  busca: string;
};

export const SEM_FILTRO: FiltroDaLista = { motivo: null, setor: null, item: null, busca: "" };

export const SEM_SETOR = "Sem setor";

/** A mesma chave que o servidor usa nos grupos: id do insumo, ou "dish:<id>" para prato pronto. */
export const chaveDoLancamento = (e: Pick<WasteEntry, "productId" | "dishId" | "id">) => e.productId ?? (e.dishId ? `dish:${e.dishId}` : e.id);

const semAcento = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const temFiltro = (f: FiltroDaLista) => Boolean(f.motivo || f.setor || f.item || f.busca.trim());

export function filtrarLancamentos(itens: WasteEntry[], filtro: FiltroDaLista): WasteEntry[] {
  const termo = semAcento(filtro.busca.trim());
  return itens.filter((e) => {
    if (filtro.motivo && e.reason !== filtro.motivo) return false;
    if (filtro.setor && (e.sectorName ?? SEM_SETOR) !== filtro.setor) return false;
    if (filtro.item && chaveDoLancamento(e) !== filtro.item.chave) return false;
    if (!termo) return true;
    return semAcento([e.productName, e.productCode, e.sectorName, e.notes, e.reasonLabel].filter(Boolean).join(" ")).includes(termo);
  });
}
