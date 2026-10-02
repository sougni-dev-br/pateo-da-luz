import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Company, Payable } from "../../api/client";
import { descreverSuspeito, type SuspeitoLote } from "../../lib/folha-duplicidade";
import { Notice, type NoticeState } from "../../components/Notice";
import { Alert, Button, Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Janela } from "./Janela";
import type { FormBaixa, OpcaoForma } from "./ModalBaixa";
import { avisoDataDoLote, dataDaBaixaNoLote, favorecidoDoTitulo, isTaxPayment, resumoDatasDoLote, todayKey, valorDoTitulo } from "./regras";

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

  // A falta da forma aparece ao lado do campo: o aviso geral fica no topo, fora da vista.
  const campoForma = useRef<HTMLSelectElement>(null);
  const [faltaForma, setFaltaForma] = useState(false);
  function confirmar() {
    if (temNaoImposto && !form.paidPaymentMethod) {
      setFaltaForma(true);
      campoForma.current?.focus();
      return;
    }
    onConfirmar();
  }

  // Depois de enviar a seleção é limpa: o título conta o que foi enviado, não o que sobrou selecionado.
  const quantidade = resultado ? resultado.ok + resultado.erros.length : selecionados.length;
  const hoje = todayKey();
  // Baixar com a data de hoje títulos vencidos há semanas costuma ser engano (a data real é outra).
  const avisoData = avisoDataDoLote(selecionados, form.paidDate, usarVencimento, hoje);
  const datas = resumoDatasDoLote(selecionados, hoje);
  // No vencimento, a data única só vale para quem ainda não venceu; sem nenhum, o campo some.
  // Data apagada continua à vista: a baixa exige a data e sem o campo não haveria como corrigir.
  const mostraDataUnica = !usarVencimento || datas.aVencer > 0 || !form.paidDate;
  const dataUnicaTexto = form.paidDate ? formatDate(form.paidDate) : "sem data";
  const quandoNoRodape = !usarVencimento
    ? `em ${dataUnicaTexto}`
    : datas.aVencer > 0
      ? `vencidos no vencimento · ${datas.aVencer} em ${dataUnicaTexto}`
      : "no vencimento de cada título";

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
          <div className="pg-lote-resumo">
            <div>
              <span>Total do lote</span>
              <strong className="pg-lote-total"><Money value={total} /></strong>
            </div>
            <div className="pg-lote-resumo-meta">
              <span>{selecionados.length} título(s)</span>
              {datas.primeiro && (
                <span className="pg-tnum">
                  {datas.primeiro === datas.ultimo
                    ? `vencimento ${formatDate(datas.primeiro)}`
                    : `vencimentos de ${formatDate(datas.primeiro)} a ${formatDate(datas.ultimo)}`}
                </span>
              )}
              {datas.vencidos > 0 && <span className="pg-lote-vencidos">{datas.vencidos} vencido(s)</span>}
            </div>
          </div>

          <fieldset className="pg-lote-sec">
            <legend>Quando foi pago?</legend>
            {onUsarVencimento && (
              <div className="pg-lote-opcoes">
                <label className="pg-lote-opcao">
                  <input type="radio" name="lote-data" checked={usarVencimento} onChange={() => onUsarVencimento(true)} />
                  <CalendarClock size={18} aria-hidden />
                  <span>
                    <strong>No vencimento de cada título</strong>
                    <small>Cada vencido é baixado na data em que venceu.</small>
                  </span>
                </label>
                <label className="pg-lote-opcao">
                  <input type="radio" name="lote-data" checked={!usarVencimento} onChange={() => onUsarVencimento(false)} />
                  <CalendarDays size={18} aria-hidden />
                  <span>
                    <strong>Numa data só</strong>
                    <small>Todos recebem a mesma data de pagamento.</small>
                  </span>
                </label>
              </div>
            )}
            {mostraDataUnica && (
              <label className="pg-lote-data">
                {usarVencimento && datas.aVencer > 0 ? `Data dos ${datas.aVencer} que ainda não venceram *` : "Data do pagamento *"}
                <input type="date" value={form.paidDate} onChange={(e) => onCampo("paidDate", e.target.value)} />
              </label>
            )}
            {avisoData && <Alert tone="warning" role="alert">{avisoData}</Alert>}
          </fieldset>

          <fieldset className="pg-lote-sec">
            <legend>Como foi pago?</legend>
            <div className="form-grid">
              {temNaoImposto && (
                <div className="pg-lote-campo">
                  <label>
                    Forma de pagamento *
                    <select
                      ref={campoForma}
                      value={form.paidPaymentMethod}
                      aria-invalid={faltaForma || undefined}
                      aria-describedby={faltaForma ? "lote-falta-forma" : undefined}
                      onChange={(e) => { setFaltaForma(false); onCampo("paidPaymentMethod", e.target.value); }}
                    >
                      <option value="">Selecione</option>
                      {formas.map((opt) => <option key={opt.id} value={`id:${opt.id}`}>{opt.label}</option>)}
                    </select>
                  </label>
                  {faltaForma && <span id="lote-falta-forma" className="pg-lote-erro-campo" role="alert">Escolha a forma de pagamento.</span>}
                </div>
              )}
              {temNaoImposto && companies.length > 0 && (
                <label>
                  Empresa pagadora
                  <select value={form.payingCompanyId} onChange={(e) => onEmpresa(e.target.value)}>
                    <option value="">Selecione…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.tradeName}</option>)}
                  </select>
                </label>
              )}
              <label className="full-width">
                Observação
                <input value={form.paymentNotes} onChange={(e) => onCampo("paymentNotes", e.target.value)} />
              </label>
            </div>
          </fieldset>

          <div className="pg-lote-sec">
            <div className="pg-lote-lista-topo">
              <span>Títulos do lote</span>
              <small>Cada um baixa pelo próprio valor. Para desconto ou juros, baixe o título sozinho.</small>
            </div>
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
          </div>

          {suspeitos && suspeitos.length > 0 ? (
            <div ref={blocoSuspeitos} role="alert" className="pg-lote-suspeitos">
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
            <div className="pg-lote-rodape">
              <span className="pg-lote-rodape-resumo">
                <Money value={total} />
                <small>{quandoNoRodape}</small>
              </span>
              <div className="modal-actions">
                <Button variant="secondary" onClick={onFechar} disabled={ocupado}>Cancelar</Button>
                <Button leadingIcon={<CheckCircle2 size={16} />} onClick={confirmar} disabled={ocupado}>
                  {ocupado ? "Baixando…" : `Confirmar baixa de ${selecionados.length}`}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Janela>
  );
}
