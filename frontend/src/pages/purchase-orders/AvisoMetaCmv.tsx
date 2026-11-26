// Aviso no detalhe do pedido de compra: com este pedido, as compras comprometidas do mês cabem na
// meta geral de CMV? Só aparece para quem vê o CMV Real (decisão do Eli): quem só compra não vê
// faturamento nem meta. Informa, não bloqueia. Pedido já enviado não tem mais decisão: nada aparece.
import { useEffect, useState } from "react";
import { type ImpactoPedidoMetaCmv, getImpactoPedidoMetaCmv } from "../../api/client";
import { Alert, Money } from "../../design-system";
import type { AlertTone } from "../../design-system";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

const TOM: Record<string, AlertTone> = { VERDE: "success", AMARELO: "warning", VERMELHO: "error", SEM_DADOS: "info" };
const TITULO: Record<string, string> = {
  VERDE: "Cabe na meta de CMV do mês",
  AMARELO: "Perto do teto da meta de CMV",
  VERMELHO: "Passa do teto da meta de CMV",
  SEM_DADOS: "Meta de CMV do mês",
};

type Props = {
  orderId: string;
  /** Muda quando o pedido é salvo: as quantidades e o total podem ter mudado. */
  versao: string;
};

export function AvisoMetaCmv({ orderId, versao }: Props) {
  const [impacto, setImpacto] = useState<ImpactoPedidoMetaCmv | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    setFalhou(false);
    getImpactoPedidoMetaCmv(orderId)
      .then((r) => { if (vivo) setImpacto(r); })
      .catch(() => { if (vivo) { setImpacto(null); setFalhou(true); } });
    return () => { vivo = false; };
  }, [orderId, versao]);

  if (falhou) return <p className="po-meta-falha">Não foi possível calcular o efeito deste pedido na meta de CMV.</p>;
  if (!impacto || impacto.situacao === "SEM_DECISAO") return null;
  if (impacto.situacao === "SEM_META") {
    return <Alert tone="info">Sem meta de CMV cadastrada para este mês. Cadastre em CMV → Metas de CMV para ver aqui se o pedido cabe.</Alert>;
  }

  const { depois, statusAntes, statusDepois, meta, pedido } = impacto;
  const foraDoCmv = Math.max(0, pedido.total - pedido.totalCmv);
  const semRitmo = depois.margemParaComprar == null;

  return (
    <Alert tone={TOM[statusDepois]} title={TITULO[statusDepois]} data-testid="aviso-meta-cmv">
      {semRitmo ? (
        <>Ainda não há faturamento no mês para projetar o teto. Com este pedido, as compras comprometidas vão a <Money value={depois.comprasComprometidas} />.</>
      ) : (
        <>
          Com este pedido, as compras comprometidas do mês vão a <Money value={depois.comprasComprometidas} /> — {pct(depois.percentualProjetado)} do
          faturamento projetado (<Money value={depois.faturamentoProjetado} />), para meta de {pct(meta.alvoPercentual)}.{" "}
          {depois.margemParaComprar! >= 0
            ? <>Depois dele ainda dá para comprar <Money value={depois.margemParaComprar} />.</>
            : <>Passa do teto em <Money value={-depois.margemParaComprar!} />.</>}
          {statusAntes === "VERMELHO" && " O mês já estava acima do teto antes deste pedido."}
        </>
      )}
      {(foraDoCmv > 0 || pedido.itensSemPreco > 0) && (
        <span className="po-meta-nota">
          {foraDoCmv > 0 && <> <Money value={foraDoCmv} /> deste pedido não entram no CMV.</>}
          {pedido.itensSemPreco > 0 && <> {pedido.itensSemPreco} {pedido.itensSemPreco === 1 ? "item sem preço estimado ficou" : "itens sem preço estimado ficaram"} fora da conta.</>}
        </span>
      )}
    </Alert>
  );
}
