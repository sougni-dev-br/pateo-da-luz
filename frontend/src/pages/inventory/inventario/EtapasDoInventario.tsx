import { Check } from "lucide-react";
import type { OperationalInventory } from "../../../api/client";
import { formatDate, formatNumber } from "../../../utils/format";
import { proximoPasso } from "./lista";

// Onde o inventario esta e o que falta. Antes era so um selo "rascunho" no
// canto: ninguem via que depois vinha revisao, aprovacao (que cria a base do
// CMV) e fechamento, nem quando cada passo aconteceu.

const ETAPA_DO_STATUS: Record<string, number> = {
  RASCUNHO: 0,
  REJEITADO: 0,
  EM_REVISAO: 1,
  APROVADO: 2,
  FECHADO: 3
};

type Props = {
  inventario: OperationalInventory;
  /** Final CMV: produtos controlados ainda sem contagem. Muda o proximo passo. */
  faltamNaCobertura?: number;
};

export function EtapasDoInventario({ inventario, faltamNaCobertura = 0 }: Props) {
  if (inventario.status === "CANCELADO") {
    return (
      <div className="etapas etapas--cancelado" role="status">
        <strong>Cancelado{inventario.canceledAt ? ` em ${formatDate(inventario.canceledAt)}` : ""}.</strong>
        {inventario.cancelReason && <span> Motivo: {inventario.cancelReason}</span>}
      </div>
    );
  }

  const atual = ETAPA_DO_STATUS[inventario.status] ?? 0;
  const contados = `${formatNumber(inventario.countedItems)} de ${formatNumber(inventario.totalItems)} contados`;
  const etapas = [
    { nome: "Contagem", detalhe: contados },
    { nome: "Revisão", detalhe: inventario.sentToReviewAt ? `enviado em ${formatDate(inventario.sentToReviewAt)}` : null },
    { nome: inventario.type === "FINAL_CMV" ? "Aprovado · base do CMV" : "Aprovado", detalhe: inventario.approvedAt ? formatDate(inventario.approvedAt) : null },
    { nome: "Fechado", detalhe: inventario.closedAt ? formatDate(inventario.closedAt) : null }
  ];
  // Todos os itens lancados nao basta no Final CMV: faltando produto na
  // cobertura, "pronto para revisao" contradizia o aviso logo abaixo.
  const passo = faltamNaCobertura > 0 && ["RASCUNHO", "REJEITADO"].includes(inventario.status)
    ? { texto: `Faltam ${faltamNaCobertura} ${faltamNaCobertura === 1 ? "produto" : "produtos"} na cobertura do mês`, tom: "atencao" as const }
    : proximoPasso(inventario);
  const devolvido = inventario.status === "REJEITADO";

  return (
    <div className="etapas">
      <ol className="etapas__lista" aria-label="Etapas do inventário">
        {etapas.map((etapa, indice) => {
          const estado = indice < atual || inventario.status === "FECHADO" ? "feita" : indice === atual ? "atual" : "futura";
          return (
            <li key={etapa.nome} className={`etapas__item etapas__item--${estado}${devolvido && indice === 0 ? " etapas__item--devolvida" : ""}`} aria-current={estado === "atual" ? "step" : undefined}>
              <span className="etapas__marca" aria-hidden="true">{estado === "feita" ? <Check size={12} strokeWidth={3} /> : indice + 1}</span>
              <span className="etapas__texto">
                <strong>{etapa.nome}</strong>
                {/* Data de etapa futura confunde: um rascunho reaberto ainda
                    carrega o "enviado em" da revisao anterior. */}
                {etapa.detalhe && estado !== "futura" && <small>{etapa.detalhe}</small>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={`etapas__passo invl-passo invl-passo--${passo.tom}`}>
        {passo.texto}
        {devolvido && inventario.rejectionReason && <span className="etapas__motivo"> — {inventario.rejectionReason}</span>}
      </p>
    </div>
  );
}
