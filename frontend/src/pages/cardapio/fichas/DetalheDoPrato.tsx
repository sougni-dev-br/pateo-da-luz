import { AlertTriangle, Copy, Pencil, Power, Printer, RotateCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import type { DishDetail, DishIngredient } from "../../../api/client";
import { Alert, Button, IconButton, Money, Percent, StatusBadge } from "../../../design-system";
import type { StatusTone } from "../../../design-system";
import {
  CMV_ALTO,
  CMV_BOM,
  faixaDeCmv,
  formatarQuantidade,
  normalizarUnidade,
  rotuloDoCanal,
  situacaoDaFicha
} from "../../../lib/fichaTecnica";
import { formatPercent } from "../../../utils/format";
import { ROTULO_DO_CARDAPIO, caminhoDaCategoria, categoriaNoCardapio, menusDoPrato } from "../../../lib/categoriasDasFichas";
import { HistoricoDaFicha } from "./HistoricoDaFicha";
import { PrecosPorCanal } from "./PrecosPorCanal";

type Props = {
  prato: DishDetail;
  canEdit: boolean;
  onEditar: () => void;
  onCopiar: () => void;
  onAlternarAtivo: () => void;
  onImprimir: () => void;
  onFechar: () => void;
  /** Depois de mexer no preço de uma loja: recarrega o prato. */
  onPrecosMudaram: () => void;
  notificar: (tom: "success" | "error", mensagem: string) => void;
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
        Bom até {CMV_BOM}% · atenção até {CMV_ALTO}% · alto acima disso
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

/** Explica, em uma frase, por que o prato vendido nos dois cardápios tem duas fichas e de onde vem cada preço. */
function ExplicacaoDasFichas() {
  return (
    <p className="ft-explica">
      <strong>Este prato é vendido no a la carte e no delivery, por isso tem duas fichas.</strong> Cada uma tem o seu porcionamento:
      a quantidade de um não vale para o outro. O custo, o CMV e a margem do alto são do <strong>a la carte</strong>; o CMV do delivery
      aparece em “Preços por canal”, loja por loja, porque o preço muda de uma plataforma e de uma loja para outra.
    </p>
  );
}

/** Prato vendido nos dois cardápios sem as quantidades do delivery: as do a la carte não valem para ele. */
function AvisoDoDelivery({ prato, canEdit, onEditar }: Pick<Props, "prato" | "canEdit" | "onEditar">) {
  if (!prato.alsoMenu || (prato.alsoItems?.length ?? 0) > 0) return null;
  return (
    <Alert tone="warning" title="Faltam as quantidades do delivery">
      As quantidades da ficha são as do a la carte e não valem para o delivery, então o CMV do delivery não é calculado.
      {canEdit && prato.isActive && (
        <>
          {" "}
          <button type="button" className="ft-link" onClick={onEditar}>Informar as quantidades do delivery</button>
        </>
      )}
    </Alert>
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

function Ingredientes({ titulo, idBase, itens, total, rendimento }: { titulo: string; idBase: string; itens: DishIngredient[]; total: number; rendimento: { qtd: number; unidade: string } }) {
  if (itens.length === 0) return null;

  return (
    <section className="ft-secao" aria-labelledby={`ft-ingredientes-${idBase}`}>
      <h3 id={`ft-ingredientes-${idBase}`} className="ft-secao-titulo">
        {titulo} <span className="ft-secao-n">{itens.length}</span>
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
            {itens.map((item: DishIngredient) => {
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
                        {item.embalagemInferida && normalizarUnidade(item.unit) !== normalizarUnidade(item.productUnit) && ` · ${item.embalagemInferida}`}
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
              <th scope="row" colSpan={2}>Custo da receita{rendimento.qtd !== 1 ? ` (rende ${formatarQuantidade(rendimento.qtd)} ${rendimento.unidade})` : ""}</th>
              <td className="ft-num"><strong><Money value={total} /></strong></td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

export function DetalheDoPrato({ prato, canEdit, onEditar, onCopiar, onAlternarAtivo, onImprimir, onFechar, onPrecosMudaram, notificar }: Props) {
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
            {menusDoPrato(prato).map((menu) => (
              <span key={menu} className="ft-detalhe-cardapio">
                <span className={`ft-etiqueta-cardapio${menu === "DELIVERY" ? " ft-etiqueta-cardapio--delivery" : ""}`}>{ROTULO_DO_CARDAPIO[menu]}</span>
                <span>{caminhoDaCategoria(categoriaNoCardapio(prato, menu))}</span>
              </span>
            ))}
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
          <Button variant="secondary" size="sm" leadingIcon={<Printer size={15} aria-hidden />} onClick={onImprimir}>Imprimir ficha</Button>
          <IconButton className="ft-fechar" icon={<X size={16} aria-hidden />} label="Fechar a ficha" size="sm" onClick={onFechar} />
        </div>
      </header>

      <Aviso prato={prato} canEdit={canEdit} onEditar={onEditar} />
      <AvisoDoDelivery prato={prato} canEdit={canEdit} onEditar={onEditar} />
      {prato.alsoMenu && <ExplicacaoDasFichas />}

      <section className="ft-resumo-ficha" aria-label="Resumo do prato">
        <div className={`ft-hero ft-hero--${mostraCmv ? (prato.custoIncompleto ? "warning" : faixa?.tom ?? "neutro") : "neutro"}`}>
          <span className="ft-metrica-rotulo">{prato.alsoMenu ? "CMV no a la carte" : "CMV"}</span>
          <strong className="ft-hero-valor">{mostraCmv ? <Percent value={prato.cmvPercentual} /> : "—"}</strong>
          <span className="ft-hero-faixa">
            {semFicha ? "sem ficha" : !mostraCmv ? "falta o preço" : prato.custoIncompleto ? "no mínimo — custo parcial" : `CMV ${faixa?.rotulo}`}
          </span>
          {mostraCmv && !prato.custoIncompleto && prato.cmvPercentual != null && <ReguaDoCmv cmv={prato.cmvPercentual} />}
        </div>

        <div className="ft-trio">
          <Metrica rotulo={prato.alsoMenu ? "Custo por porção (a la carte)" : "Custo por porção"} ajuda={prato.yieldQty !== 1 ? `receita inteira: R$ ${prato.calculatedCost.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : undefined}>
            {semFicha ? "—" : <Money value={prato.custoPorcao} />}
          </Metrica>
          <Metrica rotulo={prato.alsoMenu ? "Preço no a la carte" : "Preço de venda"} ajuda={prato.salePriceDefault == null ? "não definido" : undefined}>
            <Money value={prato.salePriceDefault} />
          </Metrica>
          <Metrica
            rotulo="Margem bruta"
            destaque={semFicha || prato.margemBruta == null || prato.custoIncompleto ? undefined : margemNegativa ? "danger" : "success"}
            ajuda={prato.custoIncompleto && prato.margemBruta != null ? "no máximo — custo parcial" : undefined}
          >
            {semFicha ? "—" : <Money value={prato.margemBruta} />}
          </Metrica>
        </div>
      </section>

      <Ingredientes
        titulo={prato.alsoMenu ? "Porcionamento no a la carte" : "Ingredientes"}
        idBase="salao"
        itens={prato.items}
        total={prato.calculatedCost}
        rendimento={{ qtd: prato.yieldQty, unidade: prato.yieldUnit }}
      />
      {prato.alsoMenu && (
        <Ingredientes
          titulo="Porcionamento no delivery"
          idBase="delivery"
          itens={prato.alsoItems ?? []}
          total={prato.alsoCusto?.calculatedCost ?? 0}
          rendimento={{ qtd: prato.yieldQty, unidade: prato.yieldUnit }}
        />
      )}
      <PrecosPorCanal prato={prato} canEdit={canEdit} onEditarPrato={onEditar} onMudou={onPrecosMudaram} notificar={notificar} />
      <HistoricoDaFicha pratoId={prato.id} versao={prato.updatedAt} />

      {prato.notes && (
        <section className="ft-secao" aria-labelledby="ft-obs">
          <h3 id="ft-obs" className="ft-secao-titulo">Observações</h3>
          <p className="ft-observacoes">{prato.notes}</p>
        </section>
      )}
    </article>
  );
}
