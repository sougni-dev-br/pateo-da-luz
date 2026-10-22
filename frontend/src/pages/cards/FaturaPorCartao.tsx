import { useEffect, useMemo, useState } from "react";
import { Check, Layers, ListChecks } from "lucide-react";
import type { CreditCardFinal, CreditCardStatementDetail } from "../../api/client";
import { Money, StatusBadge } from "../../design-system";
import { formatDate } from "../../utils/format";
import {
  buscarLinhas,
  filtrarLinhas,
  rotuloDoFinal,
  tipoDoFinal,
  transicaoDeSelecao,
  type FiltroDeCartao
} from "./cartoes-vinculados";
import { ConciliarExtrato } from "./ConciliarExtrato";
import "./cards-finais.css";

type Linha = CreditCardStatementDetail["items"][number];

type Props = {
  detalhe: CreditCardStatementDetail;
  podeEditar: boolean;
  /** Define o cartão de uma ou mais linhas (null = voltar para "não definido"). */
  onClassificar: (itemIds: string[], cardFinalId: string | null) => Promise<void>;
  /** Grava o total que o extrato traz para um cartão ("" apaga). */
  onTotalDoExtrato: (cardFinalId: string, valor: string) => Promise<boolean>;
  /** Marca várias linhas como conferidas (conciliação com o extrato colado). */
  onConferirLinhas: (itemIds: string[]) => Promise<void>;
  renderAcoes: (linha: Linha) => React.ReactNode;
};

function totalDeclarado(detalhe: CreditCardStatementDetail, cardFinalId: string): string {
  const achado = detalhe.finalTotals?.find((t) => t.cardFinalId === cardFinalId);
  return achado ? Number(achado.statedAmount).toFixed(2).replace(".", ",") : "";
}

export function FaturaPorCartao({ detalhe, podeEditar, onClassificar, onTotalDoExtrato, onConferirLinhas, renderAcoes }: Props) {
  const finais: CreditCardFinal[] = (detalhe.creditCard.finais ?? []).filter((final) => final.isActive);
  const temFinais = finais.length > 0;
  const [filtro, setFiltro] = useState<FiltroDeCartao>("todos");
  const [selecionadas, setSelecionadas] = useState<ReadonlySet<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [rascunhos, setRascunhos] = useState<Record<string, string>>({});
  const [busca, setBusca] = useState("");
  const [gravadoId, setGravadoId] = useState<string | null>(null);
  const [compacto, setCompacto] = useState(false);
  const [ordem, setOrdem] = useState<"data" | "valor">("data");
  const [conciliando, setConciliando] = useState(false);
  const editavel = podeEditar && ["OPEN", "CHECKED"].includes(detalhe.status);

  const linhasVisiveis = useMemo(() => {
    const filtradas = buscarLinhas(filtrarLinhas(detalhe.items, filtro), busca);
    return [...filtradas].sort((a, b) =>
      ordem === "valor"
        ? Number(b.value) - Number(a.value)
        : String(a.itemDate ?? "").localeCompare(String(b.itemDate ?? ""))
    );
  }, [detalhe.items, filtro, busca, ordem]);
  const semCartao = detalhe.items.filter((linha) => !linha.cardFinalId).length;
  const subtotais = detalhe.subtotaisPorCartao ?? [];
  const divergentes = new Map((detalhe.divergenciasPorCartao ?? []).map((d) => [d.cardFinalId, d]));

  // Trocar de fatura ou de filtro nunca deixa seleção de linhas que sumiram da tela.
  useEffect(() => {
    setSelecionadas(new Set());
    setFiltro("todos");
    setBusca("");
    setRascunhos({});
  }, [detalhe.id]);
  useEffect(() => {
    const ids = new Set(detalhe.items.map((linha) => linha.id));
    setSelecionadas((atual) => new Set([...atual].filter((id) => ids.has(id))));
  }, [detalhe.items]);

  async function classificar(ids: string[], cardFinalId: string | null) {
    if (ids.length === 0 || ocupado) return;
    setOcupado(true);
    try {
      await onClassificar(ids, cardFinalId);
      setSelecionadas(new Set());
    } finally {
      setOcupado(false);
    }
  }

  const idsVisiveis = linhasVisiveis.map((linha) => linha.id);
  const todasMarcadas = idsVisiveis.length > 0 && idsVisiveis.every((id) => selecionadas.has(id));

  return (
    <div className="fatura-cartoes">
      {temFinais && (
        <div className="fatura-cartoes-resumo" role="group" aria-label="Subtotal por cartão">
          {finais.map((final) => {
            const subtotal = subtotais.find((s) => s.cardFinalId === final.id);
            const divergencia = divergentes.get(final.id);
            const declarado = totalDeclarado(detalhe, final.id);
            const rascunho = rascunhos[final.id] ?? declarado;
            return (
              <article
                key={final.id}
                className={`fatura-cartao-card${filtro === final.id ? " ativo" : ""}`}
              >
                <button
                  type="button"
                  className="fatura-cartao-filtro"
                  aria-pressed={filtro === final.id}
                  onClick={() => setFiltro(filtro === final.id ? "todos" : final.id)}
                >
                  <span className="fatura-cartao-nome">{tipoDoFinal(final.kind)} <small>final {final.last4Digits}</small></span>
                  <strong><Money value={subtotal?.total ?? 0} /></strong>
                  <small>{subtotal?.itens ?? 0} lançamento(s)</small>
                </button>
                {podeEditar && (
                  <label className="fatura-cartao-extrato">
                    Total no extrato
                    <input
                      inputMode="decimal"
                      placeholder="0,00"
                      value={rascunho}
                      disabled={!["OPEN", "CHECKED"].includes(detalhe.status)}
                      onChange={(event) => setRascunhos({ ...rascunhos, [final.id]: event.target.value })}
                      onBlur={() => {
                        if (rascunho === declarado) return;
                        void onTotalDoExtrato(final.id, rascunho).then((gravou) => {
                          if (!gravou) return;
                          setGravadoId(final.id);
                          window.setTimeout(() => setGravadoId((atual) => (atual === final.id ? null : atual)), 2500);
                        });
                      }}
                    />
                  </label>
                )}
                {gravadoId === final.id && <span className="fatura-cartao-gravado" role="status">Total gravado</span>}
                {declarado && !divergencia && (
                  <span className="fatura-cartao-ok"><Check size={13} /> Bate com o extrato</span>
                )}
                {divergencia && (
                  <span className="fatura-cartao-diferenca">
                    Diferença de <Money value={Math.abs(divergencia.diferenca)} /> {divergencia.diferenca < 0 ? "a menos" : "a mais"} que o extrato
                  </span>
                )}
              </article>
            );
          })}
          <article className={`fatura-cartao-card sem${filtro === "sem" ? " ativo" : ""}${semCartao > 0 ? " pendente" : ""}`}>
            <button
              type="button"
              className="fatura-cartao-filtro"
              aria-pressed={filtro === "sem"}
              onClick={() => setFiltro(filtro === "sem" ? "todos" : "sem")}
            >
              <span className="fatura-cartao-nome">Não definido</span>
              <strong><Money value={subtotais.find((s) => s.cardFinalId === null)?.total ?? 0} /></strong>
              <small>{semCartao} lançamento(s) sem cartão</small>
            </button>
          </article>
        </div>
      )}

      <div className="fatura-cartoes-busca">
        <input
          type="search"
          value={busca}
          placeholder="Buscar por descrição, fornecedor ou valor"
          aria-label="Buscar lançamentos da fatura"
          onChange={(event) => setBusca(event.target.value)}
        />
        <select value={ordem} aria-label="Ordenar lançamentos" onChange={(event) => setOrdem(event.target.value as "data" | "valor")}>
          <option value="data">Ordem do extrato (data)</option>
          <option value="valor">Maior valor primeiro</option>
        </select>
        <label className="fatura-cartoes-modo">
          <input type="checkbox" checked={compacto} onChange={(event) => setCompacto(event.target.checked)} />
          Modo extrato (só data, descrição, cartão e valor)
        </label>
        {editavel && (
          <button type="button" className="secondary-button" onClick={() => setConciliando(!conciliando)}>
            <ListChecks size={14} /> Conciliar com o extrato
          </button>
        )}
        {temFinais && editavel && semCartao > 0 && (
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setSelecionadas(
                transicaoDeSelecao(selecionadas, detalhe.items.filter((linha) => !linha.cardFinalId).map((linha) => linha.id), true)
              )
            }
          >
            Selecionar os {semCartao} sem cartão
          </button>
        )}
      </div>

      {conciliando && editavel && (
        <ConciliarExtrato
          itens={detalhe.items}
          onConferir={async (ids) => {
            await onConferirLinhas(ids);
          }}
          onFechar={() => setConciliando(false)}
        />
      )}

      {temFinais && editavel && selecionadas.size > 0 && (
        <div className="fatura-cartoes-lote" role="region" aria-label="Ação em lote">
          <strong>{selecionadas.size} selecionado(s)</strong>
          {finais.map((final) => (
            <button
              key={final.id}
              type="button"
              className="secondary-button"
              disabled={ocupado}
              onClick={() => void classificar([...selecionadas], final.id)}
            >
              Passar para {rotuloDoFinal(final)}
            </button>
          ))}
          <button type="button" disabled={ocupado} onClick={() => void classificar([...selecionadas], null)}>
            Marcar como não definido
          </button>
          <button type="button" onClick={() => setSelecionadas(new Set())}>Limpar seleção</button>
        </div>
      )}

      <div className="table-wrap operational-table fatura-itens-tabela">
        <table>
          <thead>
            <tr>
              {temFinais && editavel && (
                <th className="fatura-col-selecao">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todas as linhas mostradas"
                    checked={todasMarcadas}
                    onChange={(event) => setSelecionadas(transicaoDeSelecao(selecionadas, idsVisiveis, event.target.checked))}
                  />
                </th>
              )}
              <th>Data</th>
              {!compacto && <th>Parcela</th>}
              <th>Descrição</th>
              {!compacto && <th>Fornecedor</th>}
              {temFinais && <th>Cartão</th>}
              <th className="numeric-cell">Valor</th>
              <th>Conf.</th>
              {!compacto && <th>Div.</th>}
              {!compacto && <th>Ação</th>}
            </tr>
          </thead>
          <tbody>
            {linhasVisiveis.map((item) => {
              const fornecedor = item.supplierName ?? item.purchase?.supplier?.name ?? "-";
              const parcela = item.installment != null && item.totalInstallments != null
                ? `${item.installment}/${item.totalInstallments}`
                : item.installment != null ? String(item.installment) : "-";
              return (
                <tr key={item.id} className={selecionadas.has(item.id) ? "fatura-linha-selecionada" : undefined}>
                  {temFinais && editavel && (
                    <td className="fatura-col-selecao" data-label="Selecionar">
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${item.description}`}
                        checked={selecionadas.has(item.id)}
                        onChange={(event) => setSelecionadas(transicaoDeSelecao(selecionadas, [item.id], event.target.checked))}
                      />
                    </td>
                  )}
                  <td className="nowrap-cell" data-label="Data">{formatDate(item.itemDate)}</td>
                  {!compacto && <td className="numeric-cell nowrap-cell" data-label="Parcela">{parcela}</td>}
                  <td title={item.description} data-label="Descrição">
                    {item.description}
                    {!item.purchaseId && <> <StatusBadge tone="warning">sem compra</StatusBadge></>}
                  </td>
                  {!compacto && <td title={fornecedor} data-label="Fornecedor">{fornecedor}</td>}
                  {temFinais && (
                    <td data-label="Cartão">
                      <div className="fatura-troca" role="group" aria-label={`Cartão de ${item.description}`}>
                        {finais.map((final) => (
                          <button
                            key={final.id}
                            type="button"
                            className={`fatura-troca-opcao${item.cardFinalId === final.id ? " marcado" : ""}`}
                            aria-pressed={item.cardFinalId === final.id}
                            disabled={!editavel || ocupado}
                            title={`${rotuloDoFinal(final)}`}
                            onClick={() => void classificar([item.id], item.cardFinalId === final.id ? null : final.id)}
                          >
                            {tipoDoFinal(final.kind)}
                          </button>
                        ))}
                        {!item.cardFinalId && <span className="fatura-sem-cartao">não definido</span>}
                      </div>
                    </td>
                  )}
                  <td className="numeric-cell nowrap-cell" data-label="Valor"><Money value={item.value} /></td>
                  <td data-label="Conferida">{item.checked ? "✓" : "–"}</td>
                  {!compacto && <td data-label="Divergência">{item.hasDivergence ? "⚠" : "–"}</td>}
                  {!compacto && <td className="actions-cell" data-label="Ação">{renderAcoes(item)}</td>}
                </tr>
              );
            })}
            {linhasVisiveis.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-table-state">
                  {filtro === "todos" ? "Esta fatura ainda não tem lançamentos." : "Nenhum lançamento neste filtro."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!temFinais && podeEditar && (
        <p className="text-muted fatura-cartoes-dica">
          <Layers size={14} /> A fatura traz mais de um cartão (físico e virtual)? Cadastre os finais em
          “Editar cartão” para classificar cada lançamento e conferir o subtotal de cada um.
        </p>
      )}
    </div>
  );
}
