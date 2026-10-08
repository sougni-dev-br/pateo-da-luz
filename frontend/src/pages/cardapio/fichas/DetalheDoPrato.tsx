import { AlertTriangle, Copy, Pencil, Power, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import type { DishDetail, DishIngredient, DishListing } from "../../../api/client";
import { Alert, Button, IconButton, Money, Percent, StatusBadge } from "../../../design-system";
import type { StatusTone } from "../../../design-system";
import {
  CMV_ALTO,
  CMV_BOM,
  faixaDeCmv,
  formatarQuantidade,
  rotuloDoCanal,
  situacaoDaFicha
} from "../../../lib/fichaTecnica";
import { formatPercent } from "../../../utils/format";

type Props = {
  prato: DishDetail;
  canEdit: boolean;
  onEditar: () => void;
  onCopiar: () => void;
  onAlternarAtivo: () => void;
  onFechar: () => void;
};

/** Escala da régua do CMV: acima de 60% não muda mais a leitura. */
const ESCALA_DO_CMV = 60;

function dataHora(iso: string): string {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ReguaDoCmv({ cmv }: { cmv: number }) {
  const faixa = faixaDeCmv(cmv);
  const posicao = Math.min(Math.max(cmv, 0), ESCALA_DO_CMV) / ESCALA_DO_CMV * 100;
  return (
    <div className="ft-regua">
      <div className="ft-regua-trilho" aria-hidden>
        <span className="ft-regua-faixa ft-regua-faixa--bom" style={{ flexBasis: `${(CMV_BOM / ESCALA_DO_CMV) * 100}%` }} />
        <span className="ft-regua-faixa ft-regua-faixa--atencao" style={{ flexBasis: `${((CMV_ALTO - CMV_BOM) / ESCALA_DO_CMV) * 100}%` }} />
        <span className="ft-regua-faixa ft-regua-faixa--alto" style={{ flexBasis: `${((ESCALA_DO_CMV - CMV_ALTO) / ESCALA_DO_CMV) * 100}%` }} />
        <span className="ft-regua-marca" style={{ left: `${posicao}%` }} />
      </div>
      <p className="ft-regua-legenda">
        CMV {faixa?.rotulo}: até {CMV_BOM}% é bom, até {CMV_ALTO}% pede atenção, acima disso é alto.
      </p>
    </div>
  );
}

function Metrica({ rotulo, children, destaque, ajuda }: { rotulo: string; children: ReactNode; destaque?: StatusTone; ajuda?: string }) {
  return (
    <div className={`ft-metrica${destaque ? ` ft-metrica--${destaque}` : ""}`}>
      <span className="ft-metrica-rotulo">{rotulo}</span>
      <strong className="ft-metrica-valor">{children}</strong>
      {ajuda && <span className="ft-metrica-ajuda">{ajuda}</span>}
    </div>
  );
}

function Aviso({ prato, canEdit, onEditar }: Pick<Props, "prato" | "canEdit" | "onEditar">) {
  const situacao = situacaoDaFicha(prato);
  const pendentes = prato.items.filter((item) => item.itemCost == null);

  if (situacao === "sem-ficha") {
    return (
      <Alert tone="info" title="Esta ficha ainda não tem ingredientes">
        Sem eles o custo, a margem e o CMV ficam em branco.
        {canEdit && prato.isActive && (
          <>
            {" "}
            <button type="button" className="ft-link" onClick={onEditar}>Montar a ficha</button>
          </>
        )}
      </Alert>
    );
  }

  if (situacao === "incompleta") {
    return (
      <Alert tone="warning" title="Custo parcial — o CMV real é maior que o mostrado">
        {pendentes.length === 1 ? "1 ingrediente ficou fora da conta:" : `${pendentes.length} ingredientes ficaram fora da conta:`}
        <ul className="ft-pendencias">
          {pendentes.map((item) => (
            <li key={item.id}><strong>{item.productName}</strong> — {item.issue ?? "sem custo calculado"}</li>
          ))}
        </ul>
      </Alert>
    );
  }

  if (situacao === "sem-preco") {
    return (
      <Alert tone="info" title="Falta o preço de venda">
        A ficha está completa, mas sem preço não há margem nem CMV.
        {canEdit && prato.isActive && (
          <>
            {" "}
            <button type="button" className="ft-link" onClick={onEditar}>Definir preço</button>
          </>
        )}
      </Alert>
    );
  }

  return null;
}

function ListagensDoPrato({ prato }: { prato: DishDetail }) {
  if (prato.listings.length === 0) return null;
  const temCusto = prato.items.length > 0 && !prato.custoIncompleto;

  return (
    <section className="ft-secao" aria-labelledby="ft-onde-vende">
      <h3 id="ft-onde-vende" className="ft-secao-titulo">Onde é vendido</h3>
      <div className="ft-tabela-rolagem">
        <table className="ft-tabela">
          <thead>
            <tr>
              <th scope="col">Loja</th>
              <th scope="col">Canal</th>
              <th scope="col" className="ft-num">Preço de tabela</th>
              <th scope="col" className="ft-num">CMV sobre a tabela</th>
            </tr>
          </thead>
          <tbody>
            {prato.listings.map((listagem: DishListing) => {
              const cmv = temCusto && listagem.price > 0 ? (prato.custoPorcao / listagem.price) * 100 : null;
              const faixa = faixaDeCmv(cmv);
              return (
                <tr key={listagem.id} className={listagem.isActive ? undefined : "ft-linha-inativa"}>
                  <th scope="row" data-rotulo="Loja">
                    {listagem.storeName ?? "Sem loja"}
                    {!listagem.isActive && <StatusBadge tone="neutral" className="ft-etiqueta">Pausado</StatusBadge>}
                  </th>
                  <td data-rotulo="Canal">{rotuloDoCanal(listagem.channel)}</td>
                  <td className="ft-num" data-rotulo="Preço de tabela"><Money value={listagem.price} /></td>
                  <td className="ft-num" data-rotulo="CMV sobre a tabela">
                    {cmv == null ? "—" : <StatusBadge tone={faixa?.tom ?? "neutral"}>{formatPercent(cmv)}</StatusBadge>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="ft-nota">
        É o preço de tabela do cardápio. Na 99 o desconto é bancado em boa parte pela loja, então o líquido
        que entra fica bem abaixo disso e o CMV sobre o que a loja recebe é maior.
      </p>
    </section>
  );
}

function Ingredientes({ prato }: { prato: DishDetail }) {
  if (prato.items.length === 0) return null;
  const total = prato.calculatedCost;

  return (
    <section className="ft-secao" aria-labelledby="ft-ingredientes">
      <h3 id="ft-ingredientes" className="ft-secao-titulo">
        Ingredientes <span className="ft-secao-n">{prato.items.length}</span>
      </h3>
      <div className="ft-tabela-rolagem">
        <table className="ft-tabela ft-tabela--ingredientes">
          <thead>
            <tr>
              <th scope="col">Ingrediente</th>
              <th scope="col" className="ft-num">Quantidade</th>
              <th scope="col" className="ft-num">Custo</th>
              <th scope="col" className="ft-parte">Parte do custo</th>
            </tr>
          </thead>
          <tbody>
            {prato.items.map((item: DishIngredient) => {
              const parte = item.itemCost != null && total > 0 ? (item.itemCost / total) * 100 : null;
              return (
                <tr key={item.id} className={item.itemCost == null ? "ft-linha-alerta" : undefined}>
                  <th scope="row" data-rotulo="Ingrediente">
                    <span className="ft-ingrediente-nome">{item.productName}</span>
                    {item.itemCost == null && item.issue ? (
                      <span className="ft-ingrediente-alerta"><AlertTriangle size={13} aria-hidden /> {item.issue}</span>
                    ) : item.unitCost != null ? (
                      <span className="ft-ingrediente-sub">
                        {item.productCode ? `${item.productCode} · ` : ""}Estoque: <Money value={item.unitCost} />{item.productUnit ? ` / ${item.productUnit}` : ""}
                      </span>
                    ) : null}
                  </th>
                  <td className="ft-num" data-rotulo="Quantidade">
                    {formatarQuantidade(item.quantity)} {item.unit}
                    {item.wasteFactor > 0 && <span className="ft-ingrediente-sub">+{formatPercent(item.wasteFactor * 100, 0)} de perda</span>}
                  </td>
                  <td className="ft-num" data-rotulo="Custo">
                    {item.itemCost != null ? <Money value={item.itemCost} /> : <span className="ft-sem-valor">sem custo</span>}
                  </td>
                  <td className="ft-parte" data-rotulo="Parte do custo">
                    {parte == null ? "—" : (
                      <span className="ft-parte-celula">
                        <span className="ft-parte-barra" aria-hidden><i style={{ width: `${Math.min(parte, 100)}%` }} /></span>
                        <Percent value={parte} decimals={0} />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>Custo da receita{prato.yieldQty !== 1 ? ` (rende ${formatarQuantidade(prato.yieldQty)} ${prato.yieldUnit})` : ""}</th>
              <td className="ft-num"><strong><Money value={total} /></strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

export function DetalheDoPrato({ prato, canEdit, onEditar, onCopiar, onAlternarAtivo, onFechar }: Props) {
  const semFicha = prato.items.length === 0;
  const faixa = faixaDeCmv(prato.cmvPercentual);
  const mostraCmv = !semFicha && prato.cmvPercentual != null;
  const margemNegativa = prato.margemBruta != null && prato.margemBruta < 0;

  return (
    <article className="ft-detalhe" aria-labelledby="ft-detalhe-titulo">
      <header className="ft-detalhe-topo">
        <div className="ft-detalhe-titulos">
          <h2 id="ft-detalhe-titulo" className="ft-detalhe-nome" tabIndex={-1}>{prato.name}</h2>
          <p className="ft-detalhe-meta">
            {prato.category && <span>{prato.category.name}</span>}
            {prato.code && <span>Código {prato.code}</span>}
            <span>Rende {formatarQuantidade(prato.yieldQty)} {prato.yieldUnit}</span>
            <span>Atualizado em {dataHora(prato.updatedAt)}</span>
          </p>
          {!prato.isActive && <StatusBadge tone="danger">Inativo</StatusBadge>}
        </div>

        <div className="ft-detalhe-acoes">
          {canEdit && (<>
            {prato.isActive && <Button variant="secondary" size="sm" leadingIcon={<Pencil size={15} aria-hidden />} onClick={onEditar}>Editar</Button>}
            <Button variant="secondary" size="sm" leadingIcon={<Copy size={15} aria-hidden />} onClick={onCopiar}>Copiar</Button>
            {prato.isActive
              ? <Button variant="danger" size="sm" leadingIcon={<Power size={15} aria-hidden />} onClick={onAlternarAtivo}>Inativar</Button>
              : <Button variant="secondary" size="sm" leadingIcon={<RotateCcw size={15} aria-hidden />} onClick={onAlternarAtivo}>Reativar</Button>}
          </>)}
          <IconButton className="ft-fechar" icon={<X size={16} aria-hidden />} label="Fechar a ficha" size="sm" onClick={onFechar} />
        </div>
      </header>

      <Aviso prato={prato} canEdit={canEdit} onEditar={onEditar} />

      <div className="ft-metricas">
        <Metrica rotulo="Custo por porção" ajuda={prato.yieldQty !== 1 ? `receita inteira: R$ ${prato.calculatedCost.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined}>
          {semFicha ? "—" : <Money value={prato.custoPorcao} />}
        </Metrica>
        <Metrica rotulo="Preço de venda" ajuda={prato.salePriceDefault == null ? "não definido" : undefined}>
          <Money value={prato.salePriceDefault} />
        </Metrica>
        <Metrica
          rotulo="Margem bruta"
          destaque={semFicha || prato.margemBruta == null || prato.custoIncompleto ? undefined : margemNegativa ? "danger" : "success"}
          ajuda={prato.custoIncompleto && prato.margemBruta != null ? "no máximo — custo parcial" : undefined}
        >
          {semFicha ? "—" : <Money value={prato.margemBruta} />}
        </Metrica>
        <Metrica
          rotulo="CMV"
          destaque={mostraCmv ? (prato.custoIncompleto ? "warning" : faixa?.tom) : undefined}
          ajuda={mostraCmv ? (prato.custoIncompleto ? "no mínimo — custo parcial" : faixa?.rotulo) : undefined}
        >
          {mostraCmv ? <Percent value={prato.cmvPercentual} /> : "—"}
        </Metrica>
      </div>

      {mostraCmv && !prato.custoIncompleto && prato.cmvPercentual != null && <ReguaDoCmv cmv={prato.cmvPercentual} />}

      <Ingredientes prato={prato} />
      <ListagensDoPrato prato={prato} />

      {prato.notes && (
        <section className="ft-secao" aria-labelledby="ft-obs">
          <h3 id="ft-obs" className="ft-secao-titulo">Observações</h3>
          <p className="ft-observacoes">{prato.notes}</p>
        </section>
      )}
    </article>
  );
}
