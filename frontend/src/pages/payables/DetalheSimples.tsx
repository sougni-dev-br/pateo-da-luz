import { Trash2 } from "lucide-react";
import type { AuditLog, Payable } from "../../api/client";
import { Notice, type NoticeState } from "../../components/Notice";
import { Button, Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import { Campo, StatusTitulo } from "./Campos";
import { Janela } from "./Janela";
import { estaEmAberto, isExtra, isPayroll } from "./regras";
import { TabelaAuditoria } from "./TabelaAuditoria";

type Props = {
  titulo: Payable;
  historico: AuditLog[];
  notice: NoticeState | null;
  /** null = formulário de exclusão fechado. */
  excluirMotivo: string | null;
  excluindo: boolean;
  onMotivo: (motivo: string | null) => void;
  onExcluir: () => void;
  onFechar: () => void;
};

const MIN_MOTIVO = 3;

/** Imposto, lançamento da Folha ou diária de extra. */
export function DetalheSimples({ titulo, historico, notice, excluirMotivo, excluindo, onMotivo, onExcluir, onFechar }: Props) {
  const tipo = isExtra(titulo) ? "Diária de extra" : isPayroll(titulo) ? "Folha de pagamento" : "Imposto / Guia";
  const rotuloPessoa = isExtra(titulo) ? "Pessoa" : isPayroll(titulo) ? "Funcionário" : "Empresa";
  const podeExcluir = isPayroll(titulo) && estaEmAberto(titulo);
  // Folha/extra: o nome da pessoa é o que identifica; o tipo (VT, Rescisão…) vai no sobretítulo.
  const pessoal = isPayroll(titulo) || isExtra(titulo);
  const cabecalho = pessoal ? (titulo.taxCompanyName ?? titulo.supplierName) : (titulo.taxDocumentType ?? titulo.supplierName);
  const sobretitulo = pessoal && titulo.taxDocumentType ? `${tipo} · ${titulo.taxDocumentType}` : tipo;

  return (
    <Janela eyebrow={sobretitulo} titulo={cabecalho} onFechar={onFechar} ocupado={excluindo} largura="media">
      <section className="modal-section pg-sec-primeira">
        <dl className="pg-campos">
          <Campo rotulo="Status"><StatusTitulo status={titulo.status} /></Campo>
          <Campo rotulo="Vencimento">{formatDate(titulo.dueDate)}</Campo>
          <Campo rotulo="Valor"><Money value={titulo.amount ?? 0} /></Campo>
          {titulo.paidDate && <Campo rotulo="Pago em">{formatDate(titulo.paidDate)}</Campo>}
          {titulo.paidAmount && <Campo rotulo="Valor pago"><Money value={titulo.paidAmount} /></Campo>}
          {titulo.taxCompanyName && <Campo rotulo={rotuloPessoa}>{titulo.taxCompanyName}</Campo>}
          {titulo.taxCnpj && <Campo rotulo="CNPJ">{titulo.taxCnpj}</Campo>}
          {titulo.taxCompetenceDate && <Campo rotulo="Competência">{formatDate(titulo.taxCompetenceDate)}</Campo>}
          {titulo.taxDocumentType && <Campo rotulo="Tipo">{titulo.taxDocumentType}</Campo>}
          {titulo.taxDescription && <Campo rotulo="Descrição">{titulo.taxDescription}</Campo>}
          {titulo.taxDreCategoryName && <Campo rotulo="Categoria DRE">{titulo.taxDreCategoryName}</Campo>}
        </dl>
      </section>

      {titulo.paymentNotes && (
        <section className="modal-section">
          <h3 className="modal-section-title">Observações</h3>
          <p className="pg-texto">{titulo.paymentNotes}</p>
        </section>
      )}

      {podeExcluir && (
        <section className="modal-section pg-excluir">
          <h3 className="modal-section-title">Não vai ser pago?</h3>
          {excluirMotivo === null ? (
            <>
              <p className="pg-nota">Exclua o lançamento da Folha que não vai ser pago (ex.: VT de quem saiu). Fica registrado com o motivo.</p>
              <Button variant="secondary" size="sm" leadingIcon={<Trash2 size={14} />} onClick={() => onMotivo("")}>
                Excluir lançamento
              </Button>
            </>
          ) : (
            <>
              <Notice notice={notice} />
              <label className="pg-campo-texto">
                <span>Motivo da exclusão *</span>
                <textarea
                  rows={2}
                  placeholder="Ex.: desligado antes do mês, VT não pago"
                  value={excluirMotivo}
                  onChange={(e) => onMotivo(e.target.value)}
                  autoFocus
                />
              </label>
              <div className="modal-actions">
                <Button variant="secondary" onClick={() => onMotivo(null)} disabled={excluindo}>Cancelar</Button>
                <Button
                  variant="danger"
                  leadingIcon={<Trash2 size={16} />}
                  disabled={excluirMotivo.trim().length < MIN_MOTIVO || excluindo}
                  onClick={onExcluir}
                >
                  {excluindo ? "Excluindo…" : "Confirmar exclusão"}
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      {historico.length > 0 && (
        <section className="modal-section">
          <h3 className="modal-section-title">Histórico</h3>
          <TabelaAuditoria linhas={historico} />
        </section>
      )}
    </Janela>
  );
}
