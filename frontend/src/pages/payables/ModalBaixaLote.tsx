import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Company, Payable } from "../../api/client";
import { descreverSuspeito, type SuspeitoLote } from "../../lib/folha-duplicidade";
import { Notice, type NoticeState } from "../../components/Notice";
import { Alert, Button, Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Janela } from "./Janela";
import type { FormBaixa, OpcaoForma } from "./ModalBaixa";
import { avisoDataDoLote, dataDaBaixaNoLote, favorecidoDoTitulo, isTaxPayment, todayKey, valorDoTitulo } from "./regras";

export type ResultadoLote = { ok: number; erros: Array<{ nome: string; motivo: string }> };

type Props = {
  selecionados: Payable[];
  total: number;
  form: FormBaixa;
  onCampo: <K extends keyof FormBaixa>(campo: K, valor: FormBaixa[K]) => void;
  /** Título vencido é baixado na própria data de vencimento (os demais, na data única). */
  usarVencimento?: boolean;
  onUsarVencimento?: (usar: boolean) => void;
  onEmpresa: (companyId: string) => void;
  formas: OpcaoForma[];
  companies: Company[];
  notice: NoticeState | null;
  ocupado: boolean;
  resultado: ResultadoLote | null;
  /** Títulos da folha que parecem pagamento em duplicidade (conferidos antes de baixar). */
  suspeitos?: SuspeitoLote[] | null;
  onTirarSuspeitos?: () => void;
  onBaixarMesmoAssim?: () => void;
  onFechar: () => void;
  onFecharResultado: () => void;
  onConfirmar: () => void;
};

export function ModalBaixaLote({ selecionados, total, form, onCampo, usarVencimento = false, onUsarVencimento, onEmpresa, formas, companies, notice, ocupado, resultado, suspeitos, onTirarSuspeitos, onBaixarMesmoAssim, onFechar, onFecharResultado, onConfirmar }: Props) {
  const temNaoImposto = selecionados.some((p) => !isTaxPayment(p));
  // Os suspeitos aparecem no pé da janela, fora da vista: rola até eles.
  const blocoSuspeitos = useRef<HTMLDivElement>(null);
  const haSuspeitos = Boolean(suspeitos && suspeitos.length > 0);
  useEffect(() => {
    if (haSuspeitos) blocoSuspeitos.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [haSuspeitos]);

  // Depois de enviar a seleção é limpa: o título conta o que foi enviado, não o que sobrou selecionado.
  const quantidade = resultado ? resultado.ok + resultado.erros.length : selecionados.length;
  const hoje = todayKey();
  // Baixar com a data de hoje títulos vencidos há semanas costuma ser engano (a data real é outra).
  const avisoData = avisoDataDoLote(selecionados, form.paidDate, usarVencimento, hoje);

  return (
    <Janela eyebrow="Baixa em lote" titulo={`Baixar ${quantidade} título(s)`} onFechar={onFechar} ocupado={ocupado}>
      <Notice notice={notice} />

      {resultado && resultado.erros.length > 0 ? (
        <>
          <Alert tone="warning">
            {resultado.ok} baixado(s) com sucesso, {resultado.erros.length} falhou(ram). Os que falharam continuam em aberto.
          </Alert>
          <ul className="pg-lote-erros">
            {resultado.erros.map((e, idx) => (
              <li key={idx}><strong>{e.nome}</strong> — {e.motivo}</li>
            ))}
          </ul>
          <div className="modal-actions">
            <Button onClick={onFecharResultado}>Fechar</Button>
          </div>
        </>
      ) : (
        <>
          <div className="pay-ctx">
            <div className="pay-ctx-row">
              <div><span>Títulos</span><strong>{selecionados.length}</strong></div>
              <div className="pg-ctx-valor"><span>Total</span><strong className="pay-ctx-amount"><Money value={total} /></strong></div>
            </div>
          </div>

          <p className="pg-nota">
            Cada título recebe a baixa pelo <strong>seu próprio valor</strong>, com os mesmos dados abaixo.
            Para pagar valor diferente do original (desconto ou juros), baixe aquele título individualmente.
          </p>

          <div className="form-grid">
            <label>
              {usarVencimento ? "Data dos títulos não vencidos *" : "Data do pagamento *"}
              <input type="date" value={form.paidDate} onChange={(e) => onCampo("paidDate", e.target.value)} />
            </label>
            {onUsarVencimento && (
              <label className="checkbox-label">
                <input type="checkbox" checked={usarVencimento} onChange={(e) => onUsarVencimento(e.target.checked)} />
                Usar a data de vencimento de cada título
              </label>
            )}
            {temNaoImposto && (
              <label>
                Forma de pagamento *
                <select value={form.paidPaymentMethod} onChange={(e) => onCampo("paidPaymentMethod", e.target.value)}>
                  <option value="">Selecione</option>
                  {formas.map((opt) => <option key={opt.id} value={`id:${opt.id}`}>{opt.label}</option>)}
                </select>
              </label>
            )}
            <label>
              Observação
              <input value={form.paymentNotes} onChange={(e) => onCampo("paymentNotes", e.target.value)} />
            </label>
            {temNaoImposto && companies.length > 0 && (
              <label>
                Empresa pagadora
                <select value={form.payingCompanyId} onChange={(e) => onEmpresa(e.target.value)}>
                  <option value="">Selecione…</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                </select>
              </label>
            )}
          </div>

          {avisoData && <Alert tone="warning" role="alert">{avisoData}</Alert>}
          {usarVencimento && (
            <p className="pg-nota">
              Cada título vencido é baixado na data em que venceu; os que ainda vão vencer ficam com a data acima.
            </p>
          )}

          <ul className="pg-lote-lista" aria-label="Títulos selecionados">
            {selecionados.map((p) => (
              <li key={p.id}>
                <span className="pg-lote-nome">
                  {favorecidoDoTitulo(p)}
                  {p.taxDescription ? ` · ${p.taxDescription}` : ""}
                </span>
                <span className="pg-lote-venc">
                  {formatDate(p.dueDate)}
                  {usarVencimento ? ` · baixa em ${formatDate(dataDaBaixaNoLote(p, true, form.paidDate, hoje))}` : ""}
                </span>
                <strong className="pg-num"><Money value={valorDoTitulo(p)} /></strong>
              </li>
            ))}
          </ul>

          {suspeitos && suspeitos.length > 0 ? (
            <div ref={blocoSuspeitos} role="alert">
              <Alert tone="warning">
                Nada foi baixado ainda: {suspeitos.length} título(s) parecem pagamento em duplicidade.
                Tire-os do lote ou confirme que é para baixar mesmo assim (a confirmação fica na auditoria).
              </Alert>
              <ul className="pg-lote-erros" aria-label="Títulos suspeitos de duplicidade">
                {suspeitos.map((s) => <li key={s.item.id ?? ""}>{descreverSuspeito(s)}</li>)}
              </ul>
              <div className="modal-actions">
                <Button variant="secondary" onClick={onTirarSuspeitos} disabled={ocupado}>{suspeitos.length === 1 ? "Tirar este do lote" : `Tirar os ${suspeitos.length} do lote`}</Button>
                <Button leadingIcon={<AlertTriangle size={16} />} onClick={onBaixarMesmoAssim} disabled={ocupado}>
                  {ocupado ? "Baixando…" : "Baixar mesmo assim"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="modal-actions">
              <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Cancelar</Button>
              <Button leadingIcon={<CheckCircle2 size={16} />} onClick={onConfirmar} disabled={ocupado}>
                {ocupado ? "Baixando…" : `Confirmar baixa de ${selecionados.length}`}
              </Button>
            </div>
          )}
        </>
      )}
    </Janela>
  );
}
