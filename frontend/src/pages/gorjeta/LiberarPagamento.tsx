// Passo 5 da aba Contabilidade: liberar a folha para pagamento. Cria no Contas a Pagar um
// título por empresa (e um dos sem registro), cada um com os salários das pessoas do grupo;
// a baixa acontece lá. Quando todos os títulos são baixados, a "Folha paga" marca sozinha.
import { ExternalLink, Send } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  type TipEtapasEstado, type TipFolhaLote, type TipFolhaLotePrevia,
  cancelarTipFolhaLiberada, getTipFolhaLotesPrevia, liberarTipFolha,
} from "../../api/client";
import { Button, StatusBadge } from "../../design-system";
import { money, mutedStyle, panelStyle } from "./gorjetaUtils";

type Props = {
  year: number;
  month: number;
  lotes: TipFolhaLote[];
  /** Salários da competência em aberto fora dos títulos: a folha paga não marca enquanto houver. */
  soltos?: number;
  onSoltos?: (n: number) => void;
  /** OK à contabilidade dado: só então se libera. */
  liberavel: boolean;
  canEdit: boolean;
  onLotes: (lotes: TipFolhaLote[]) => void;
  onEtapas: (etapas: TipEtapasEstado) => void;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
};

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const SITUACAO: Record<string, { rotulo: string; tom: "success" | "warning" }> = {
  PAGO: { rotulo: "Pago", tom: "success" },
  ABERTO: { rotulo: "Em aberto", tom: "warning" },
};

/** Resumo do passo: "3 títulos · 1 de 3 pagos" (ou o convite para liberar). */
export function resumoDosLotes(lotes: TipFolhaLote[]): string {
  if (lotes.length === 0) return "cria os títulos por empresa no Contas a Pagar";
  const pagos = lotes.filter((l) => l.status === "PAGO").length;
  return `${lotes.length} título(s) no Contas a Pagar · ${pagos} de ${lotes.length} pago(s)`;
}

export function LiberarPagamento({ year, month, lotes, soltos = 0, onSoltos, liberavel, canEdit, onLotes, onEtapas, onNotice }: Props) {
  const [previa, setPrevia] = useState<TipFolhaLotePrevia | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const erro = (e: unknown) => onNotice("error", (e as Error).message);
  const algumPago = lotes.some((l) => l.status === "PAGO");
  const todosPagos = lotes.length > 0 && lotes.every((l) => l.status === "PAGO");

  async function abrirPrevia() {
    setOcupado(true);
    try { setPrevia(await getTipFolhaLotesPrevia(year, month)); } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  async function liberar() {
    setOcupado(true);
    try {
      const r = await liberarTipFolha(year, month);
      onLotes(r.lotes);
      onEtapas(r.etapas);
      onSoltos?.(r.soltos ?? 0);
      setPrevia(null);
      const msg = r.criados.length > 0
        ? `Folha liberada: ${r.criados.length} título(s) criado(s) no Contas a Pagar.`
        : r.acrescentados > 0 ? `${r.acrescentados} lançamento(s) acrescentado(s) aos títulos.` : "Nada novo a liberar.";
      onNotice(r.avisos.length ? "warning" : "success", r.avisos.length ? `${msg} Confira: ${r.avisos.join(" ")}` : msg);
    } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  async function cancelar() {
    const motivo = window.prompt("Por que desfazer a liberação? Os títulos em aberto serão cancelados e os salários voltam soltos ao Contas a Pagar.");
    if (!motivo || motivo.trim().length < 3) return;
    setOcupado(true);
    try {
      const r = await cancelarTipFolhaLiberada(year, month, motivo.trim());
      onLotes([]);
      onEtapas(r.etapas);
      onNotice("success", `Liberação desfeita: ${r.cancelados} título(s) cancelado(s).`);
    } catch (e) { erro(e); } finally { setOcupado(false); }
  }

  if (!liberavel && lotes.length === 0) return null;

  return (
    <div style={panelStyle} className="liberar-pagamento">
      <div className="cabecalho-painel">
        <div className="cabecalho-painel-texto">
          <strong>Liberar para pagamento</strong>
          <span>Um título por empresa no Contas a Pagar, com o salário de cada pessoa da folha de líquidos. Vencimento: 5º dia útil do mês seguinte.</span>
        </div>
        {canEdit && liberavel && !previa && (!todosPagos || soltos > 0) && (
          <div className="cabecalho-painel-acoes">
            <Button size="sm" leadingIcon={<Send size={14} />} disabled={ocupado} onClick={() => void abrirPrevia()}>
              {lotes.length === 0 ? "Liberar para pagamento" : "Liberar de novo (acréscimos)"}
            </Button>
          </div>
        )}
      </div>

      {previa && (
        <div className="liberar-previa" role="region" aria-label="Títulos que serão criados">
          {previa.grupos.length === 0
            ? <span style={mutedStyle}>Ninguém novo para liberar: todos já estão nos títulos ou pagos.</span>
            : (
              <ul className="liberar-lista">
                {previa.grupos.map((g) => (
                  <li key={g.grupo}>
                    <strong>{g.rotulo}</strong>
                    <span style={mutedStyle}>{g.membros.length} lançamento(s) · vence {dataBr(previa.vencimento)}</span>
                    <strong className="liberar-valor">{money(g.total)}</strong>
                  </li>
                ))}
                <li className="liberar-total">
                  <strong>Total</strong><span />
                  <strong className="liberar-valor">{money(previa.grupos.reduce((a, g) => a + g.total, 0))}</strong>
                </li>
              </ul>
            )}
          {previa.avisos.length > 0 && (
            <ul className="liberar-avisos" aria-label="Avisos">
              {previa.avisos.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
          <div className="liberar-acoes">
            <Button variant="secondary" size="sm" disabled={ocupado} onClick={() => setPrevia(null)}>Cancelar</Button>
            <Button size="sm" disabled={ocupado || previa.grupos.length === 0} onClick={() => void liberar()}>
              {ocupado ? "Liberando…" : lotes.length === 0 ? "Confirmar liberação" : "Acrescentar aos títulos"}
            </Button>
          </div>
        </div>
      )}

      {lotes.length > 0 && soltos > 0 && (
        <p className="liberar-aviso" role="status">
          {soltos} salário(s) desta competência em aberto fora dos títulos (ex.: complemento lançado depois). A folha só fica paga
          quando eles entrarem num título e forem baixados: use "Liberar de novo".
        </p>
      )}
      {lotes.length > 0 && (
        <ul className="liberar-lista" aria-label="Títulos da folha no Contas a Pagar">
          {lotes.map((l) => (
            <li key={l.id}>
              <strong>{l.rotulo}</strong>
              <span style={mutedStyle}>
                {l.pessoas} pessoa(s) · vence {dataBr(l.dueDate)}
                {l.paymentDate ? ` · pago em ${dataBr(l.paymentDate)}${l.paidPaymentMethodName ? ` (${l.paidPaymentMethodName})` : ""}` : ""}
              </span>
              <span className="liberar-valor">
                <strong>{money(l.total)}</strong>
                <StatusBadge tone={(SITUACAO[l.status] ?? SITUACAO.ABERTO).tom}>{(SITUACAO[l.status] ?? SITUACAO.ABERTO).rotulo}</StatusBadge>
              </span>
            </li>
          ))}
        </ul>
      )}
      {lotes.length > 0 && (
        <div className="liberar-acoes">
          <Link className="barra-lista-link" to="/financeiro/contas-a-pagar">
            <ExternalLink size={13} /> abrir no Contas a Pagar
          </Link>
          {canEdit && !algumPago && (
            <button type="button" className="barra-lista-link" disabled={ocupado} onClick={() => void cancelar()}>desfazer a liberação</button>
          )}
        </div>
      )}
    </div>
  );
}
