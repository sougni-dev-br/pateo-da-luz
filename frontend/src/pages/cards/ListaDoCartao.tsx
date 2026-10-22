import { AlertTriangle, ArrowRightLeft, Check, CheckCircle2, Flag, Trash2 } from "lucide-react";
import type { CreditCardFinal, CreditCardStatementDetail, DivergenciaDoCartao, SubtotalDoCartao } from "../../api/client";
import { Money, RowMenu } from "../../design-system";
import { formatDate } from "../../utils/format";
import { rotuloDoFinal, tipoDoFinal } from "./cartoes-vinculados";
import "./cards-finais.css";

type Linha = CreditCardStatementDetail["items"][number];

export type AcoesDaLinha = {
  onConferida: (linha: Linha) => void;
  onDivergencia: (linha: Linha) => void;
  onRealocar: (linha: Linha) => void;
  onExcluir: (linha: Linha) => void;
};

type Props = {
  /** Cartão da lista; null = lançamentos ainda sem cartão definido. */
  final: CreditCardFinal | null;
  /** Todos os cartões ativos da conta (para trocar a linha de lista). */
  finais: CreditCardFinal[];
  linhas: Linha[];
  subtotal?: SubtotalDoCartao;
  /** Participação deste cartão no total da fatura (0–100). */
  parte: number;
  declarado: string;
  divergencia?: DivergenciaDoCartao;
  gravado: boolean;
  editavel: boolean;
  podeEditar: boolean;
  statusEditavel: boolean;
  rascunho: string;
  selecionadas: ReadonlySet<string>;
  ocupado: boolean;
  onRascunho: (valor: string) => void;
  onGravarExtrato: () => void;
  onSelecionar: (ids: string[], marcar: boolean) => void;
  onClassificar: (ids: string[], cardFinalId: string | null) => void;
  acoes: AcoesDaLinha;
  /** Conta sem cartões cadastrados: uma lista só, com todos os lançamentos. */
  semFinais?: boolean;
};

export function ListaDoCartao(props: Props) {
  const { final, finais, linhas, editavel } = props;
  const semCartao = final === null && !props.semFinais;
  const lista_unica = props.semFinais === true;
  const outros = finais.filter((outro) => outro.id !== final?.id);
  const classe = lista_unica ? "unica" : final === null ? "pendente" : final.kind === "VIRTUAL" ? "virtual" : "fisico";
  const idsDaLista = linhas.map((linha) => linha.id);
  const todasMarcadas = idsDaLista.length > 0 && idsDaLista.every((id) => props.selecionadas.has(id));

  return (
    <section id={final ? `lista-${final.id}` : "lista-sem-cartao"} className={`fatura-lista ${classe}`} aria-label={lista_unica ? "Lançamentos da fatura" : final === null ? "Lançamentos sem cartão definido" : `Compras no cartão ${tipoDoFinal(final.kind).toLowerCase()}`}>
      <header className="fatura-lista-topo">
        <div className="fatura-lista-titulo">
          <h3>
            {lista_unica ? "Lançamentos da fatura" : final === null ? "Sem cartão definido" : `Cartão ${tipoDoFinal(final.kind).toLowerCase()}`}
            {final && <code>·· {final.last4Digits}</code>}
          </h3>
          <span>{linhas.length} {linhas.length === 1 ? "lançamento" : "lançamentos"}</span>
        </div>
        <div className="fatura-lista-total">
          <strong><Money value={props.subtotal?.total ?? 0} /></strong>
          {final && <span className="fatura-lista-parte" aria-hidden><i style={{ width: `${props.parte}%` }} /></span>}
        </div>
      </header>

      {final && (
        <div className="fatura-lista-extrato">
          {props.podeEditar && (
            <label>
              <span>Total no extrato do banco</span>
              <input
                inputMode="decimal"
                placeholder="R$ 0,00"
                value={props.rascunho}
                disabled={!props.statusEditavel}
                onChange={(event) => props.onRascunho(event.target.value)}
                onBlur={props.onGravarExtrato}
              />
            </label>
          )}
          {props.gravado && <span className="fatura-cartao-gravado" role="status">Total gravado</span>}
          {props.declarado && !props.divergencia && !props.gravado && (
            <span className="fatura-cartao-ok"><Check size={14} /> Bate com o extrato</span>
          )}
          {props.divergencia && (
            <span className="fatura-cartao-diferenca">
              Diferença de <Money value={Math.abs(props.divergencia.diferenca)} /> {props.divergencia.diferenca < 0 ? "a menos" : "a mais"} que o extrato
            </span>
          )}
        </div>
      )}

      {editavel && linhas.length > 0 && (
        <label className="fatura-lista-todas">
          <input
            type="checkbox"
            checked={todasMarcadas}
            onChange={(event) => props.onSelecionar(idsDaLista, event.target.checked)}
          />
          Selecionar todos desta lista
        </label>
      )}

      {linhas.length === 0 ? (
        <p className="fatura-lista-vazia">{final === null ? "Nenhum lançamento." : "Nenhuma compra neste cartão."}</p>
      ) : (
        <ul className="fatura-lista-linhas">
          {linhas.map((item) => {
            const fornecedor = item.supplierName ?? item.purchase?.supplier?.name ?? "";
            const parcela = item.installment != null && item.totalInstallments != null
              ? `parcela ${item.installment}/${item.totalInstallments}`
              : item.installment != null ? `parcela ${item.installment}` : "";
            const subtitulo = [fornecedor, parcela].filter(Boolean).join(" · ");
            const itensDoMenu = [
              ...outros.map((outro) => ({
                label: `Passar para ${rotuloDoFinal(outro)}`,
                icon: <ArrowRightLeft size={15} />,
                onClick: () => props.onClassificar([item.id], outro.id)
              })),
              ...(final ? [{ label: "Voltar para sem cartão definido", icon: <ArrowRightLeft size={15} />, onClick: () => props.onClassificar([item.id], null) }] : []),
              { label: "Realocar para outra fatura", icon: <ArrowRightLeft size={15} />, onClick: () => props.acoes.onRealocar(item) },
              ...(!item.purchaseId ? [{ label: "Excluir linha", icon: <Trash2 size={15} />, tone: "danger" as const, onClick: () => props.acoes.onExcluir(item) }] : [])
            ];
            return (
              <li key={item.id} className={`fatura-lista-linha${props.selecionadas.has(item.id) ? " selecionada" : ""}`}>
                {editavel && (
                  <input
                    type="checkbox"
                    className="fatura-lista-check"
                    aria-label={`Selecionar ${item.description}`}
                    checked={props.selecionadas.has(item.id)}
                    onChange={(event) => props.onSelecionar([item.id], event.target.checked)}
                  />
                )}
                <span className="fatura-lista-data">{formatDate(item.itemDate)}</span>
                <div className="fatura-lista-desc">
                  <strong title={item.description}>{item.description}</strong>
                  {(subtitulo || !item.purchaseId) && (
                    <small>
                      {subtitulo}
                      {!item.purchaseId && (
                        <span className="fatura-sem-compra" title="Linha sem compra: a despesa não chega ao DRE"><AlertTriangle size={11} aria-hidden /> sem compra</span>
                      )}
                    </small>
                  )}
                </div>
                <span className="fatura-lista-valor"><Money value={item.value} /></span>
                <div className="fatura-lista-acoes">
                  {editavel && semCartao && finais.map((destino) => (
                    <button
                      key={destino.id}
                      type="button"
                      className="fatura-lista-mover"
                      disabled={props.ocupado}
                      onClick={() => props.onClassificar([item.id], destino.id)}
                    >
                      {tipoDoFinal(destino.kind)}
                    </button>
                  ))}
                  {editavel && final && outros.length === 1 && (
                    <button
                      type="button"
                      className="fatura-lista-mover"
                      disabled={props.ocupado}
                      title={`Passar para ${rotuloDoFinal(outros[0])}`}
                      onClick={() => props.onClassificar([item.id], outros[0].id)}
                    >
                      <ArrowRightLeft size={13} /> {tipoDoFinal(outros[0].kind)}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`fatura-icone${item.checked ? " ligado" : ""}`}
                    aria-pressed={item.checked}
                    aria-label={item.checked ? "Desmarcar como conferido" : "Marcar como conferido"}
                    title={item.checked ? "Conferido (clique para desmarcar)" : "Marcar como conferido"}
                    disabled={!editavel}
                    onClick={() => props.acoes.onConferida(item)}
                  >
                    <CheckCircle2 size={20} />
                  </button>
                  <button
                    type="button"
                    className={`fatura-icone alerta${item.hasDivergence ? " ligado" : ""}`}
                    aria-pressed={item.hasDivergence}
                    aria-label={item.hasDivergence ? "Remover divergência" : "Marcar divergência"}
                    title={item.hasDivergence ? "Com divergência (clique para remover)" : "Marcar divergência com o extrato"}
                    disabled={!editavel}
                    onClick={() => props.acoes.onDivergencia(item)}
                  >
                    <Flag size={17} />
                  </button>
                  {editavel && <RowMenu items={itensDoMenu} label={`Mais ações de ${item.description}`} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
