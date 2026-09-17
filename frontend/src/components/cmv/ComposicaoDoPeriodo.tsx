import { useState } from "react";
import type { CmvPeriodDetail } from "../../api/client";
import { Money, Tabs } from "../../design-system";
import "./ComposicaoDoPeriodo.css";

/**
 * De onde vieram as compras e a receita do período.
 *
 * Eram três tabelas empilhadas, ~900px de rolagem, e as três respondem a
 * perguntas diferentes que ninguém faz ao mesmo tempo: "em que eu gastei",
 * "de quem eu comprei", "de onde veio a receita". Viraram abas — o mesmo
 * conteúdo, mas quem procura fornecedor não rola categoria antes.
 *
 * O total vai no rótulo da aba de propósito: escolher a aba é uma decisão, e
 * decidir às cegas obrigaria a abrir as três para comparar.
 */

type Aba = "categorias" | "fornecedores" | "canais";

function percentualDe(total: number, parte: number) {
  if (!total) return "-";
  return `${((parte / total) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function SemDados({ colunas }: { colunas: number }) {
  return (
    <tr>
      <td colSpan={colunas} className="empty-table-state">Sem dados para este período.</td>
    </tr>
  );
}

export type ComposicaoDoPeriodoProps = {
  detail: CmvPeriodDetail | null;
};

export function ComposicaoDoPeriodo({ detail }: ComposicaoDoPeriodoProps) {
  const [aba, setAba] = useState<Aba>("categorias");

  const categorias = detail?.purchaseByCategory ?? [];
  const fornecedores = detail?.purchaseBySupplier ?? [];
  const canais = detail?.revenueByChannel ?? [];
  const totalCompras = detail?.purchasesGrossTotal ?? 0;
  const totalReceita = detail?.revenueNetTotal ?? 0;

  return (
    <div className="cmv-composicao-abas">
      <Tabs
        value={aba}
        onChange={(valor) => setAba(valor as Aba)}
        tabs={[
          { value: "categorias", label: <>Categorias <span className="cmv-composicao-contagem">{categorias.length}</span></> },
          { value: "fornecedores", label: <>Fornecedores <span className="cmv-composicao-contagem">{fornecedores.length}</span></> },
          { value: "canais", label: <>Canais de venda <span className="cmv-composicao-contagem">{canais.length}</span></> }
        ]}
      />

      {aba === "categorias" && (
        <div className="table-wrap operational-table cmv-analysis-table" role="tabpanel" aria-label="Compras por categoria">
          <table>
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th>Categoria</th>
                <th className="numeric-cell col-secundaria">Itens</th>
                <th className="numeric-cell">Participação</th>
                <th className="numeric-cell">Total</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((linha, indice) => (
                <tr key={linha.categoryName} className={indice < 3 ? "ranking-row" : ""}>
                  <td className="col-rank">{indice + 1}</td>
                  <td title={linha.categoryName}>{linha.categoryName}</td>
                  <td className="numeric-cell col-secundaria">{linha.itemsCount}</td>
                  <td className="numeric-cell nowrap-cell">{percentualDe(totalCompras, linha.totalAmount)}</td>
                  <td className="numeric-cell nowrap-cell"><Money value={linha.totalAmount} /></td>
                </tr>
              ))}
              {categorias.length === 0 && <SemDados colunas={5} />}
            </tbody>
          </table>
        </div>
      )}

      {aba === "fornecedores" && (
        <div className="table-wrap operational-table cmv-analysis-table" role="tabpanel" aria-label="Compras por fornecedor">
          <table>
            <thead>
              <tr>
                <th className="col-rank">#</th>
                <th>Fornecedor</th>
                <th className="col-secundaria">Documento</th>
                <th className="numeric-cell col-secundaria">Pedidos</th>
                <th className="numeric-cell">Participação</th>
                <th className="numeric-cell">Total</th>
              </tr>
            </thead>
            <tbody>
              {fornecedores.map((linha, indice) => (
                <tr key={linha.supplierId} className={indice < 3 ? "ranking-row" : ""}>
                  <td className="col-rank">{indice + 1}</td>
                  <td title={linha.supplierName}>{linha.supplierName}</td>
                  <td className="nowrap-cell col-secundaria">{linha.supplierDocument ?? "-"}</td>
                  <td className="numeric-cell col-secundaria">{linha.purchasesCount}</td>
                  <td className="numeric-cell nowrap-cell">{percentualDe(totalCompras, linha.totalAmount)}</td>
                  <td className="numeric-cell nowrap-cell"><Money value={linha.totalAmount} /></td>
                </tr>
              ))}
              {fornecedores.length === 0 && <SemDados colunas={6} />}
            </tbody>
          </table>
        </div>
      )}

      {aba === "canais" && (
        <div className="table-wrap operational-table cmv-analysis-table" role="tabpanel" aria-label="Faturamento por canal">
          <table>
            <thead>
              <tr>
                <th>Canal</th>
                <th className="numeric-cell col-secundaria">Qtd.</th>
                <th className="numeric-cell">Participação</th>
                <th className="numeric-cell col-secundaria">Bruto</th>
                <th className="numeric-cell">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {canais.map((linha, indice) => (
                <tr key={linha.channel} className={indice === 0 ? "ranking-row" : ""}>
                  <td>{linha.channel}</td>
                  <td className="numeric-cell col-secundaria">{linha.count}</td>
                  <td className="numeric-cell nowrap-cell">{percentualDe(totalReceita, linha.netAmount)}</td>
                  <td className="numeric-cell nowrap-cell col-secundaria"><Money value={linha.grossAmount} /></td>
                  <td className="numeric-cell nowrap-cell"><Money value={linha.netAmount} /></td>
                </tr>
              ))}
              {canais.length === 0 && <SemDados colunas={5} />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
