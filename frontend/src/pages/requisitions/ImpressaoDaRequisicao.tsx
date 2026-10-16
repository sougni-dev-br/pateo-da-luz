import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { InventoryRequisition } from "../../api/client";
import { formatDate } from "../../utils/format";
import { formatarQuantidade } from "../desperdicio/quantidade";

// Folha A4 da requisição, para quem separa os produtos no estoque e para a assinatura de quem retira.
// Os produtos vêm agrupados pelo local do estoque (câmara fria, freezer...) na ordem em que se anda pelo estoque.

export type ItemDaFolha = {
  codigo: string | null;
  nome: string;
  quantidade: number;
  unidade: string;
  local: string | null;
  antes?: number | null;
  depois?: number | null;
};

export type DadosDaFolha = {
  /** null: a requisição ainda não foi registrada (lista de separação). */
  codigo: string | null;
  data: string;
  turno: string;
  setor: string | null;
  motivo: string;
  observacoes: string | null;
  responsavel: string | null;
  itens: ItemDaFolha[];
};

const SEM_LOCAL = "Sem local definido";
const CLASSE_IMPRIMINDO = "imprimindo-requisicao";

export function agruparPorLocal(itens: ItemDaFolha[]): Array<{ local: string; itens: ItemDaFolha[] }> {
  const grupos = new Map<string, ItemDaFolha[]>();
  for (const item of itens) {
    const local = item.local?.trim() || SEM_LOCAL;
    grupos.set(local, [...(grupos.get(local) ?? []), item]);
  }
  return Array.from(grupos, ([local, lista]) => ({ local, itens: [...lista].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")) }))
    .sort((a, b) => (a.local === SEM_LOCAL ? 1 : b.local === SEM_LOCAL ? -1 : a.local.localeCompare(b.local, "pt-BR")));
}

export function dadosDaRequisicaoRegistrada(req: InventoryRequisition, rotulos: { turno: string; motivo: string }): DadosDaFolha {
  return {
    codigo: req.code,
    data: req.date,
    turno: rotulos.turno,
    setor: req.sectorName ?? null,
    motivo: req.reason === "OTHER" && req.reasonNotes ? req.reasonNotes : rotulos.motivo,
    observacoes: req.notes ?? null,
    responsavel: req.requestedByName ?? null,
    itens: (req.items ?? []).map((i) => ({
      codigo: i.productCode,
      nome: i.productName,
      quantidade: Number(i.quantity),
      unidade: i.unit ?? "",
      local: i.storageSectorName ?? null,
      antes: i.stockBefore != null ? Number(i.stockBefore) : null,
      depois: i.stockAfter != null ? Number(i.stockAfter) : null
    }))
  };
}

function Folha({ dados }: { dados: DadosDaFolha }) {
  const grupos = agruparPorLocal(dados.itens);
  const registrada = dados.codigo != null;
  return (
    <article className="rf-folha">
      <header className="rf-topo">
        <div>
          <p className="rf-marca">Pateo da Luz</p>
          <h1>Requisição de insumos</h1>
        </div>
        <p className="rf-codigo">{registrada ? dados.codigo : "LISTA DE SEPARAÇÃO — ainda não registrada"}</p>
      </header>

      <dl className="rf-meta">
        <div><dt>Data</dt><dd>{formatDate(dados.data)}</dd></div>
        <div><dt>Turno</dt><dd>{dados.turno}</dd></div>
        <div><dt>Setor</dt><dd>{dados.setor ?? "Todos"}</dd></div>
        <div><dt>Motivo</dt><dd>{dados.motivo}</dd></div>
        {dados.responsavel && <div><dt>Registrado por</dt><dd>{dados.responsavel}</dd></div>}
        {dados.observacoes && <div className="rf-meta-largo"><dt>Observações</dt><dd>{dados.observacoes}</dd></div>}
      </dl>

      <table className="rf-tabela">
        <thead>
          <tr>
            <th className="rf-conf" aria-label="Conferido" />
            <th>Cód.</th>
            <th>Produto</th>
            <th className="rf-num">Quantidade</th>
            <th>Un.</th>
            {registrada && <th className="rf-num">Antes</th>}
            {registrada && <th className="rf-num">Depois</th>}
          </tr>
        </thead>
        {grupos.map((grupo) => (
          <tbody key={grupo.local}>
            <tr className="rf-local"><th colSpan={registrada ? 7 : 5}>{grupo.local}</th></tr>
            {grupo.itens.map((item, indice) => (
              <tr key={`${item.codigo ?? item.nome}-${indice}`}>
                <td className="rf-conf"><span className="rf-caixa" /></td>
                <td>{item.codigo ?? ""}</td>
                <td>{item.nome}</td>
                <td className="rf-num"><strong>{formatarQuantidade(item.quantidade)}</strong></td>
                <td>{item.unidade}</td>
                {registrada && <td className="rf-num">{item.antes != null ? formatarQuantidade(item.antes) : ""}</td>}
                {registrada && <td className="rf-num">{item.depois != null ? formatarQuantidade(item.depois) : ""}</td>}
              </tr>
            ))}
          </tbody>
        ))}
      </table>

      <p className="rf-total">{dados.itens.length} {dados.itens.length === 1 ? "produto" : "produtos"}</p>

      <footer className="rf-assinaturas">
        <div><span /> <small>Entregue por (estoque)</small></div>
        <div><span /> <small>Retirado por</small></div>
        <div><span /> <small>Data e hora</small></div>
      </footer>
    </article>
  );
}

/**
 * Imprime a folha por um portal fora da tela: o navegador abre a janela de impressão só com ela
 * (o resto do app fica escondido em @media print) e tudo é desfeito no fim, imprimindo ou cancelando.
 */
export function useImpressaoDaRequisicao(): { imprimir: (dados: DadosDaFolha) => void; portal: ReactNode } {
  const [dados, setDados] = useState<DadosDaFolha | null>(null);

  useEffect(() => {
    if (!dados) return;
    document.body.classList.add(CLASSE_IMPRIMINDO);
    const encerrar = () => {
      document.body.classList.remove(CLASSE_IMPRIMINDO);
      window.removeEventListener("afterprint", encerrar);
      setDados(null);
    };
    window.addEventListener("afterprint", encerrar);
    // Alguns navegadores de celular não disparam afterprint: sair do modo de impressão também encerra.
    const modoImpressao = window.matchMedia?.("print");
    const aoMudarModo = (e: MediaQueryListEvent) => {
      if (!e.matches) encerrar();
    };
    modoImpressao?.addEventListener?.("change", aoMudarModo);
    // Um quadro depois, para a folha já estar no documento quando a janela de impressão abrir.
    const quadro = window.requestAnimationFrame(() => window.print());
    return () => {
      window.cancelAnimationFrame(quadro);
      window.removeEventListener("afterprint", encerrar);
      modoImpressao?.removeEventListener?.("change", aoMudarModo);
      document.body.classList.remove(CLASSE_IMPRIMINDO);
    };
  }, [dados]);

  const imprimir = useCallback((proximos: DadosDaFolha) => setDados(proximos), []);
  const portal = dados ? createPortal(<div className="rf-raiz"><Folha dados={dados} /></div>, document.body) : null;
  return { imprimir, portal };
}
