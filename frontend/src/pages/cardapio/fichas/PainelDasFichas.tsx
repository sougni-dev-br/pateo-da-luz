import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Plus, TrendingDown, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, KpiCard, Money } from "../../../design-system";
import { CMV_ALTO, CMV_BOM, faixaDeCmv, type SituacaoDaFicha } from "../../../lib/fichaTecnica";
import { veredito, type PainelDasFichas, type PratoAnalisavel } from "../../../lib/painelFichas";
import { formatPercent } from "../../../utils/format";

type Props = {
  painel: PainelDasFichas;
  canEdit: boolean;
  onIrParaPratos: (filtro: { situacao?: SituacaoDaFicha; categoriaId?: string }) => void;
  onAbrirPrato: (id: string) => void;
  onNovo: () => void;
};

/** Régua dos gráficos de CMV: acima de 60% não muda mais a leitura. */
const ESCALA_DO_CMV = 60;

function Cartao({ titulo, subtitulo, children, className }: { titulo: string; subtitulo?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`ft-p-cartao${className ? ` ${className}` : ""}`} aria-label={titulo}>
      <header className="ft-p-cartao-topo">
        <h3>{titulo}</h3>
        {subtitulo && <p>{subtitulo}</p>}
      </header>
      {children}
    </section>
  );
}

/** Uma barra por prato: o nome abre a ficha, o valor fica na ponta e o texto nunca usa a cor do dado. */
function BarraDePrato({ prato, valor, rotulo, maximo, tom, onAbrir }: {
  prato: PratoAnalisavel;
  valor: number;
  rotulo: string;
  maximo: number;
  tom: "success" | "warning" | "danger" | "gold";
  onAbrir: (id: string) => void;
}) {
  const largura = maximo > 0 ? Math.min(Math.max((valor / maximo) * 100, 2), 100) : 0;
  return (
    <li>
      <button type="button" className="ft-p-linha" onClick={() => onAbrir(prato.id)} title={`Abrir a ficha de ${prato.name}`}>
        <span className="ft-p-linha-nome">{prato.name}</span>
        <span className="ft-p-barra" aria-hidden><i className={`ft-p-barra--${tom}`} style={{ width: `${largura}%` }} /></span>
        <span className="ft-p-linha-valor">{rotulo}</span>
      </button>
    </li>
  );
}

function Pendencia({ icone, quantidade, singular, plural, dica, onClick, destaque }: {
  icone: ReactNode;
  quantidade: number;
  singular: string;
  plural: string;
  dica: string;
  onClick: () => void;
  destaque?: boolean;
}) {
  if (quantidade === 0) return null;
  return (
    <li>
      <button type="button" className={`ft-p-acao${destaque ? " ft-p-acao--destaque" : ""}`} onClick={onClick}>
        <span className="ft-p-acao-icone" aria-hidden>{icone}</span>
        <span className="ft-p-acao-texto">
          <strong>{quantidade} {quantidade === 1 ? singular : plural}</strong>
          <small>{dica}</small>
        </span>
        <ArrowRight size={16} aria-hidden />
      </button>
    </li>
  );
}

export function PainelDasFichasView({ painel, canEdit, onIrParaPratos, onAbrirPrato, onNovo }: Props) {
  const { pendencias, distribuicao, analisaveis } = painel;
  const faixaDoMedio = faixaDeCmv(painel.cmvMedio);
  const resumo = veredito(painel);
  const totalDePendencias = pendencias.semFicha + pendencias.incompletas + pendencias.semPreco + pendencias.cmvAlto;
  const maiorMargem = painel.maioresMargens[0]?.margemBruta ?? 0;
  const maiorCmv = Math.max(ESCALA_DO_CMV, painel.maioresCmv[0]?.cmvPercentual ?? 0);

  if (painel.ativos === 0) {
    return (
      <EmptyState
        title="Nenhum prato cadastrado."
        description="Cadastre o primeiro prato e monte a ficha com os ingredientes para ver custo, margem e CMV aqui."
        action={canEdit ? <Button leadingIcon={<Plus size={16} aria-hidden />} onClick={onNovo}>Cadastrar prato</Button> : undefined}
      />
    );
  }

  return (
    <div className="ft-painel-geral">
      {resumo ? (
        <div className={`ft-p-veredito ft-p-veredito--${resumo.tom}`} role="status">
          {resumo.tom === "success" ? <CheckCircle2 size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />}
          <span>{resumo.texto}</span>
        </div>
      ) : (
        <div className="ft-p-veredito ft-p-veredito--info" role="status">
          <ClipboardCheck size={18} aria-hidden />
          <span>Monte as fichas para o painel mostrar CMV e margem do cardápio.</span>
        </div>
      )}

      <div className="ft-p-kpis">
        <KpiCard
          label="Fichas montadas"
          icon={<ClipboardCheck size={18} aria-hidden />}
          tone={painel.percentualComFicha >= 90 ? "success" : painel.percentualComFicha >= 25 ? "warning" : "danger"}
          value={<>{painel.comFicha}<span className="ft-p-de"> de {painel.ativos}</span></>}
          sub={
            <span className="ft-p-meter-bloco">
              <span className="ft-p-meter" role="progressbar" aria-label="Pratos com ficha montada" aria-valuemin={0} aria-valuemax={painel.ativos} aria-valuenow={painel.comFicha}>
                <i style={{ width: `${painel.percentualComFicha}%` }} />
              </span>
              {painel.percentualComFicha}% dos pratos ativos
            </span>
          }
        />
        <KpiCard
          label="CMV médio"
          icon={<TrendingDown size={18} aria-hidden />}
          tone={faixaDoMedio?.tom ?? "neutral"}
          value={painel.cmvMedio == null ? "—" : formatPercent(painel.cmvMedio)}
          sub={analisaveis > 0 ? `Média simples de ${analisaveis} prato${analisaveis === 1 ? "" : "s"} com ficha e preço` : "Sem pratos com ficha completa e preço"}
        />
        <KpiCard
          label="Margem média"
          icon={<Wallet size={18} aria-hidden />}
          tone="neutral"
          value={painel.margemMedia == null ? "—" : <Money value={painel.margemMedia} />}
          sub="Preço de venda menos o custo da ficha"
        />
        <KpiCard
          label={`CMV acima de ${CMV_ALTO}%`}
          icon={<AlertTriangle size={18} aria-hidden />}
          tone={distribuicao.alto > 0 ? "danger" : "success"}
          value={distribuicao.alto}
          sub={distribuicao.alto > 0 ? "Pratos que custam caro demais para produzir" : "Nenhum prato fora do limite"}
        />
      </div>

      <div className="ft-p-grade ft-p-grade--2">
        <Cartao titulo="O que fazer agora" subtitulo={totalDePendencias > 0 ? "Do que mais pesa para o que menos pesa" : undefined}>
          {totalDePendencias === 0 ? (
            <p className="ft-p-tudo-certo"><CheckCircle2 size={18} aria-hidden /> Tudo em dia: todas as fichas estão completas e com preço.</p>
          ) : (
            <ul className="ft-p-acoes">
              <Pendencia icone={<AlertTriangle size={16} />} destaque quantidade={pendencias.cmvAlto} singular="prato com CMV alto" plural="pratos com CMV alto" dica="Revise o preço de venda ou a receita" onClick={() => onIrParaPratos({ situacao: "cmv-alto" })} />
              <Pendencia icone={<ClipboardCheck size={16} />} quantidade={pendencias.incompletas} singular="ficha com custo parcial" plural="fichas com custo parcial" dica="Falta custo ou conversão de unidade em algum ingrediente" onClick={() => onIrParaPratos({ situacao: "incompleta" })} />
              <Pendencia icone={<Wallet size={16} />} quantidade={pendencias.semPreco} singular="prato sem preço de venda" plural="pratos sem preço de venda" dica="Sem preço não há margem nem CMV" onClick={() => onIrParaPratos({ situacao: "sem-preco" })} />
              <Pendencia icone={<ClipboardCheck size={16} />} quantidade={pendencias.semFicha} singular="prato sem ficha" plural="pratos sem ficha" dica="Monte a lista de ingredientes de cada um" onClick={() => onIrParaPratos({ situacao: "sem-ficha" })} />
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Saúde do cardápio" subtitulo={analisaveis > 0 ? `${analisaveis} de ${painel.ativos} pratos analisados` : undefined}>
          {analisaveis === 0 ? (
            <p className="ft-p-vazio">Ainda não há prato com ficha completa e preço. Monte as primeiras fichas para ver como o cardápio se distribui.</p>
          ) : (
            <>
              <div className="ft-p-pilha" role="img" aria-label={`${distribuicao.bom} pratos com CMV bom, ${distribuicao.atencao} em atenção, ${distribuicao.alto} altos`}>
                {distribuicao.bom > 0 && <span className="ft-p-pilha--bom" style={{ flexGrow: distribuicao.bom }} />}
                {distribuicao.atencao > 0 && <span className="ft-p-pilha--atencao" style={{ flexGrow: distribuicao.atencao }} />}
                {distribuicao.alto > 0 && <span className="ft-p-pilha--alto" style={{ flexGrow: distribuicao.alto }} />}
              </div>
              <ul className="ft-p-legenda">
                <li><i className="ft-p-ponto ft-p-pilha--bom" aria-hidden /><strong>{distribuicao.bom}</strong> bom <small>até {CMV_BOM}%</small></li>
                <li><i className="ft-p-ponto ft-p-pilha--atencao" aria-hidden /><strong>{distribuicao.atencao}</strong> atenção <small>até {CMV_ALTO}%</small></li>
                <li><i className="ft-p-ponto ft-p-pilha--alto" aria-hidden /><strong>{distribuicao.alto}</strong> alto <small>acima de {CMV_ALTO}%</small></li>
              </ul>
            </>
          )}
        </Cartao>
      </div>

      {analisaveis > 0 && (
        <>
          <div className="ft-p-grade ft-p-grade--2">
            <Cartao titulo="Pedem atenção" subtitulo="Maiores CMV: quanto do preço vai para ingrediente">
              <ul className="ft-p-ranking">
                {painel.maioresCmv.map((prato) => (
                  <BarraDePrato key={prato.id} prato={prato} valor={prato.cmvPercentual} maximo={maiorCmv} rotulo={formatPercent(prato.cmvPercentual)} tom={faixaDeCmv(prato.cmvPercentual)?.tom ?? "gold"} onAbrir={onAbrirPrato} />
                ))}
              </ul>
            </Cartao>

            <Cartao titulo="Mais lucrativos" subtitulo="Maior margem por prato vendido, em reais">
              <ul className="ft-p-ranking">
                {painel.maioresMargens.map((prato) => (
                  <BarraDePrato key={prato.id} prato={prato} valor={prato.margemBruta} maximo={maiorMargem} rotulo={prato.margemBruta.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} tom="gold" onAbrir={onAbrirPrato} />
                ))}
              </ul>
            </Cartao>
          </div>

          {painel.porCategoria.length > 0 && (
            <Cartao titulo="CMV por categoria" subtitulo={`Média dos pratos analisados · as marcas na régua são ${CMV_BOM}% e ${CMV_ALTO}%`}>
              <ul className="ft-p-ranking ft-p-ranking--categorias">
                {painel.porCategoria.map((categoria) => {
                  const largura = Math.min((categoria.cmvMedio / ESCALA_DO_CMV) * 100, 100);
                  return (
                    <li key={categoria.id ?? "sem"}>
                      <button
                        type="button"
                        className="ft-p-linha"
                        disabled={categoria.id == null}
                        onClick={() => categoria.id && onIrParaPratos({ categoriaId: categoria.id })}
                        title={categoria.id ? `Ver os pratos de ${categoria.nome}` : undefined}
                      >
                        <span className="ft-p-linha-nome">{categoria.nome} <small>{categoria.pratos} prato{categoria.pratos === 1 ? "" : "s"}</small></span>
                        <span className="ft-p-barra ft-p-barra--regua" aria-hidden>
                          <i className={`ft-p-barra--${faixaDeCmv(categoria.cmvMedio)?.tom ?? "gold"}`} style={{ width: `${largura}%` }} />
                          <b style={{ left: `${(CMV_BOM / ESCALA_DO_CMV) * 100}%` }} />
                          <b style={{ left: `${(CMV_ALTO / ESCALA_DO_CMV) * 100}%` }} />
                        </span>
                        <span className="ft-p-linha-valor">{formatPercent(categoria.cmvMedio)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Cartao>
          )}
        </>
      )}
    </div>
  );
}
