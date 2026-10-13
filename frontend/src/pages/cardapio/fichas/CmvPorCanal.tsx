import { useEffect, useMemo, useState } from "react";
import { getDishNetRatios, type DishListItem, type DishNetRatios } from "../../../api/client";
import { EmptyState, Money, Select, StatusBadge, Switch, TextField } from "../../../design-system";
import {
  CMV_ALTO,
  CMV_BOM,
  FILTRO_DA_MATRIZ,
  contarSemFicha,
  filtrarMatriz,
  montarColunas,
  montarMatriz,
  resumirColunas,
  type Celula,
  type Coluna,
  type FiltroDaMatriz,
  type ModoDeAgrupamento,
  type OrdemDaMatriz,
  type RazoesLiquidas,
  type ResumoDaColuna
} from "../../../lib/cmvPorCanal";
import { faixaDeCmv } from "../../../lib/fichaTecnica";
import { formatPercent } from "../../../utils/format";

type Props = {
  /** Pratos do cardápio escolhido no alto da tela (ativos ou não: a tela filtra os ativos). */
  pratos: DishListItem[];
  carregando: boolean;
  onAbrirPrato: (id: string) => void;
};

const OPCOES_DE_ORDEM: Array<{ value: OrdemDaMatriz; label: string }> = [
  { value: "pior", label: "Pior CMV primeiro" },
  { value: "nome", label: "Nome (A–Z)" }
];

const OPCOES_DE_MODO: Array<{ valor: ModoDeAgrupamento; rotulo: string; titulo: string }> = [
  { valor: "canal", rotulo: "Por canal", titulo: "Salão, 99, iFood, Keeta: o pior CMV entre as lojas de cada plataforma" },
  { valor: "loja", rotulo: "Por loja", titulo: "Uma coluna para cada loja de cada plataforma" }
];

type BaseDoPreco = "liquido" | "tabela";

const OPCOES_DE_BASE: Array<{ valor: BaseDoPreco; rotulo: string; titulo: string }> = [
  { valor: "liquido", rotulo: "Líquido da 99", titulo: "Na 99, o preço que chega ao caixa (média da loja nos pedidos recentes). Salão, iFood e Keeta seguem pelo preço de tabela." },
  { valor: "tabela", rotulo: "Preço de tabela", titulo: "O preço anunciado, em todos os lugares." }
];

const percentual = (razao: number) => `${Math.round(razao * 100)}%`;

const TEXTO_DO_ESTADO: Record<Exclude<Celula["estado"], "ok">, { curto: string; longo: string }> = {
  "nao-vende": { curto: "—", longo: "O prato não é vendido aqui." },
  "sem-ficha": { curto: "Sem ficha", longo: "Monte a ficha para ver o CMV." },
  incompleta: { curto: "Parcial", longo: "A ficha tem ingrediente sem custo: o CMV sairia menor do que é." },
  "sem-preco": { curto: "Sem preço", longo: "Defina o preço para ver o CMV." }
};

function CelulaDeCmv({ celula }: { celula: Celula }) {
  if (celula.estado !== "ok") {
    const texto = TEXTO_DO_ESTADO[celula.estado];
    return <span className={`ft-cmv-vazio ft-cmv-vazio--${celula.estado}`} title={texto.longo}>{texto.curto}</span>;
  }
  const faixa = faixaDeCmv(celula.cmv);
  const variam = celula.lojas > 1 && celula.precoMin !== celula.precoMax;
  return (
    <span className="ft-cmv-celula">
      <StatusBadge tone={faixa?.tom ?? "neutral"}>{formatPercent(celula.cmv ?? 0)}</StatusBadge>
      <span className="ft-cmv-preco" title={celula.sobreLiquido ? "Preço líquido estimado: o que chega ao caixa" : undefined}>
        {celula.sobreLiquido && "líq. "}
        {variam
          ? <>de <Money value={celula.precoMin ?? 0} /> a <Money value={celula.precoMax ?? 0} /></>
          : <Money value={celula.preco ?? 0} />}
      </span>
    </span>
  );
}

function ResumoDoLugar({ resumo }: { resumo: ResumoDaColuna }) {
  const faixa = faixaDeCmv(resumo.cmvMedio);
  return (
    <li className="ft-cmv-resumo">
      <span className="ft-cmv-resumo-rotulo">{resumo.coluna.rotulo}</span>
      {resumo.cmvMedio == null ? (
        <strong className="ft-cmv-resumo-valor ft-cmv-resumo-valor--vazio">—</strong>
      ) : (
        <strong className={`ft-cmv-resumo-valor ft-cmv-resumo-valor--${faixa?.tom ?? "neutral"}`}>{formatPercent(resumo.cmvMedio)}</strong>
      )}
      <span className="ft-cmv-resumo-nota">
        {resumo.analisados === 0
          ? "nenhum prato com ficha e preço"
          : `${resumo.analisados} prato${resumo.analisados === 1 ? "" : "s"}${resumo.altos > 0 ? ` · ${resumo.altos} alto${resumo.altos === 1 ? "" : "s"}` : ""}`}
      </span>
    </li>
  );
}

/**
 * O CMV de cada prato em cada lugar: salão, cada plataforma e cada loja. O custo é o da ficha; o preço é o do lugar —
 * por isso o mesmo prato tem CMVs diferentes. Em "por canal", a plataforma mostra o pior CMV entre as lojas dela.
 */
export function CmvPorCanal({ pratos, carregando, onAbrirPrato }: Props) {
  const [modo, setModo] = useState<ModoDeAgrupamento>("canal");
  const [filtro, setFiltro] = useState<FiltroDaMatriz>(FILTRO_DA_MATRIZ);
  const [base, setBase] = useState<BaseDoPreco>("liquido");
  const [razoes, setRazoes] = useState<DishNetRatios | null>(null);

  // O líquido da 99 vem dos pedidos recentes; se não vier (sem pedidos, falha), a tela segue pelo preço de tabela.
  useEffect(() => {
    let vivo = true;
    getDishNetRatios().then((resposta) => { if (vivo) setRazoes(resposta); }).catch(() => { if (vivo) setRazoes(null); });
    return () => { vivo = false; };
  }, []);

  const razoesPorLoja = useMemo<RazoesLiquidas | undefined>(() => {
    if (base !== "liquido" || !razoes) return undefined;
    return Object.fromEntries(razoes.lojas.filter((loja) => loja.razao != null).map((loja) => [loja.deliveryStoreId, loja.razao as number]));
  }, [base, razoes]);
  const temLiquido = Boolean(razoes && razoes.lojas.some((loja) => loja.razao != null));

  const ativos = useMemo(() => pratos.filter((prato) => prato.isActive), [pratos]);
  const colunas = useMemo(() => montarColunas(ativos, modo), [ativos, modo]);
  const matriz = useMemo(() => montarMatriz(ativos, colunas, modo, razoesPorLoja), [ativos, colunas, modo, razoesPorLoja]);
  const resumos = useMemo(() => resumirColunas(matriz, colunas), [matriz, colunas]);
  const linhas = useMemo(() => filtrarMatriz(matriz, filtro), [matriz, filtro]);
  const semFicha = contarSemFicha(ativos);

  if (carregando && pratos.length === 0) return <p className="ft-carregando" role="status">Carregando o CMV…</p>;
  if (ativos.length === 0) {
    return <EmptyState title="Nenhum prato neste cardápio." description="Cadastre pratos e monte as fichas para ver o CMV de cada um por canal." />;
  }

  return (
    <div className="ft-cmv">
      <ul className="ft-cmv-resumos" aria-label="CMV médio por lugar">
        {resumos.map((resumo) => <ResumoDoLugar key={resumo.coluna.chave} resumo={resumo} />)}
      </ul>

      <div className="ft-cmv-controles">
        <div className="ft-segmentos" role="radiogroup" aria-label="Agrupar o CMV">
          {OPCOES_DE_MODO.map(({ valor, rotulo, titulo }) => (
            <button key={valor} type="button" role="radio" aria-checked={modo === valor} className="ft-segmento" title={titulo} onClick={() => setModo(valor)}>
              {rotulo}
            </button>
          ))}
        </div>
        <TextField
          aria-label="Buscar prato"
          placeholder="Buscar prato, código ou categoria"
          value={filtro.busca}
          onChange={(evento) => setFiltro((anterior) => ({ ...anterior, busca: evento.target.value }))}
          containerClassName="ft-cmv-busca"
        />
        {temLiquido && (
          <div className="ft-segmentos" role="radiogroup" aria-label="Preço usado no CMV">
            {OPCOES_DE_BASE.map(({ valor, rotulo, titulo }) => (
              <button key={valor} type="button" role="radio" aria-checked={base === valor} className="ft-segmento" title={titulo} onClick={() => setBase(valor)}>
                {rotulo}
              </button>
            ))}
          </div>
        )}
        <Select
          aria-label="Ordenar"
          value={filtro.ordem}
          onChange={(evento) => setFiltro((anterior) => ({ ...anterior, ordem: evento.target.value as OrdemDaMatriz }))}
          options={OPCOES_DE_ORDEM}
        />
        <label className="ft-inativos">
          <Switch checked={filtro.soAltos} onChange={(marcado) => setFiltro((anterior) => ({ ...anterior, soAltos: marcado }))} label="Só pratos com CMV alto" />
          <span>Só CMV alto</span>
        </label>
        {semFicha > 0 && (
          <label className="ft-inativos">
            <Switch checked={filtro.comSemFicha} onChange={(marcado) => setFiltro((anterior) => ({ ...anterior, comSemFicha: marcado }))} label="Incluir pratos sem ficha" />
            <span>Incluir {semFicha} sem ficha</span>
          </label>
        )}
      </div>

      <p className="ft-nota">
        CMV = custo da ficha ÷ preço do lugar. Bom até {CMV_BOM}% · atenção até {CMV_ALTO}% · alto acima disso.
        {razoesPorLoja
          ? " Na 99 o preço é o líquido estimado: o que chega ao caixa depois do desconto bancado pela loja, comissão, taxa de pagamento e frete grátis. Salão, iFood e Keeta seguem pelo preço de tabela."
          : " É sobre o preço de tabela: nas plataformas o líquido que entra é menor, então o CMV real é maior."}
        {modo === "canal" && " Onde a plataforma tem várias lojas com preços diferentes, vale o pior CMV."}
      </p>
      {razoesPorLoja && razoes && (
        <p className="ft-nota" aria-label="Quanto da tabela chega ao caixa na 99">
          Na 99, nos últimos {razoes.dias} dias, chegou ao caixa{" "}
          {razoes.lojas.filter((loja) => loja.razao != null).map((loja, indice, lista) => (
            <span key={loja.deliveryStoreId}>
              <strong>{percentual(loja.razao as number)}</strong> do preço de tabela na {loja.storeName}
              {loja.base === "plataforma" ? " (poucos pedidos: média da 99)" : ""}
              {indice < lista.length - 1 ? "; " : "."}
            </span>
          ))}{" "}
          É a média da loja: prato com oferta pesada recebe menos, e sem oferta, mais.
        </p>
      )}

      {linhas.length === 0 ? (
        <EmptyState
          title="Nenhum prato para mostrar."
          description={semFicha > 0 && !filtro.comSemFicha ? "Os pratos sem ficha ficam de fora: monte a ficha para ver o CMV, ou ligue “Incluir sem ficha”." : "Ajuste a busca ou os filtros."}
        />
      ) : (
        <div className="ft-cmv-rolagem">
          <table className="ft-cmv-tabela">
            <thead>
              <tr>
                <th scope="col" className="ft-cmv-prato">Prato · {linhas.length}</th>
                {colunas.map((coluna: Coluna) => (
                  <th key={coluna.chave} scope="col" className="ft-cmv-lugar" title={coluna.loja ? `${coluna.loja}` : coluna.rotulo}>{coluna.rotulo}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ prato, celulas }) => (
                <tr key={prato.id}>
                  <th scope="row" className="ft-cmv-prato">
                    <button type="button" className="ft-cmv-abrir" onClick={() => onAbrirPrato(prato.id)} title={`Abrir a ficha de ${prato.name}`}>
                      {prato.name}
                    </button>
                  </th>
                  {colunas.map((coluna) => (
                    <td key={coluna.chave} className="ft-cmv-lugar"><CelulaDeCmv celula={celulas[coluna.chave]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
