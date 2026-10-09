import { ChevronDown, Plus, Printer, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DishCategory, DishListItem } from "../../../api/client";
import { Button, EmptyState, IconButton, ListDetailLayout, Select, StatusBadge, Switch } from "../../../design-system";
import type { StatusTone } from "../../../design-system";
import { FILTRO_SEM_CATEGORIA, ROTULO_DO_CARDAPIO, caminhoDaCategoria, opcoesDoFiltroDeCategoria } from "../../../lib/categoriasDasFichas";
import {
  ROTULO_DA_SITUACAO,
  faixaDeCmv,
  situacaoDaFicha,
  type FiltroDaLista,
  type OrdemDaLista,
  type SituacaoDaFicha
} from "../../../lib/fichaTecnica";
import { formatPercent } from "../../../utils/format";

type Contagem = Record<SituacaoDaFicha, number> & { total: number; comFicha: number };

type Props = {
  /** Já filtrados e ordenados. */
  pratos: DishListItem[];
  totalCadastrado: number;
  /** Acompanha o que a lista mostra (inclui inativos quando o botão está ligado). */
  contagemDosChips: Contagem;
  /** Pratos do cardápio escolhido (com ou sem inativos), antes de busca, categoria e situação: base dos números do seletor. */
  pratosDoSeletor: DishListItem[];
  categorias: DishCategory[];
  filtro: FiltroDaLista;
  ordem: OrdemDaLista;
  selecionadoId: string | null;
  carregando: boolean;
  canEdit: boolean;
  modoSelecao: boolean;
  selecionados: Set<string>;
  onFiltro: (parcial: Partial<FiltroDaLista>) => void;
  onOrdem: (ordem: OrdemDaLista) => void;
  onSelecionar: (id: string) => void;
  onNovo: () => void;
  onAtualizar: () => void;
  onEntrarNaSelecao: () => void;
  onSairDaSelecao: () => void;
  onAlternarSelecao: (id: string) => void;
  onSelecionarTodos: () => void;
  onLimparSelecao: () => void;
  onMoverSelecionados: () => void;
  onImprimirSelecionados: () => void;
  onImprimirEmBranco: () => void;
};

const FILTROS_DE_SITUACAO: Array<{ valor: FiltroDaLista["situacao"]; rotulo: string; chave?: keyof Contagem }> = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "sem-ficha", rotulo: "Sem ficha", chave: "sem-ficha" },
  { valor: "incompleta", rotulo: "Incompletas", chave: "incompleta" },
  { valor: "sem-preco", rotulo: "Sem preço", chave: "sem-preco" },
  { valor: "cmv-alto", rotulo: "CMV alto", chave: "cmv-alto" }
];

const OPCOES_DE_ORDEM = [
  { value: "nome", label: "Nome (A–Z)" },
  { value: "pendencias", label: "Pendências primeiro" },
  { value: "cmv", label: "Maior CMV" },
  { value: "margem", label: "Menor margem" }
];

/** A etiqueta que resume o prato na lista: o CMV quando há, senão o que falta. */
function EtiquetaDoPrato({ prato }: { prato: DishListItem }) {
  if (!prato.isActive) return <StatusBadge tone="neutral">Inativo</StatusBadge>;

  const situacao = situacaoDaFicha(prato);
  if (situacao === "ok" || situacao === "cmv-alto") {
    const faixa = faixaDeCmv(prato.cmvPercentual);
    const tom: StatusTone = faixa?.tom ?? "neutral";
    return <StatusBadge tone={tom} title={`CMV ${faixa?.rotulo ?? ""}`.trim()}>{formatPercent(prato.cmvPercentual)}</StatusBadge>;
  }

  const tom: StatusTone = situacao === "incompleta" ? "warning" : situacao === "sem-preco" ? "info" : "neutral";
  return <StatusBadge tone={tom}>{ROTULO_DA_SITUACAO[situacao]}</StatusBadge>;
}

const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function subtituloDoPrato(prato: DishListItem, mostrarCardapio: boolean): string {
  const partes: string[] = [];
  if (mostrarCardapio) partes.push(ROTULO_DO_CARDAPIO[prato.menu]);
  partes.push(caminhoDaCategoria(prato.category));

  if (prato.salePriceDefault != null) {
    partes.push(`R$ ${moeda(prato.salePriceDefault)}`);
  } else if (prato.listingPriceMin != null) {
    partes.push(prato.listingPriceMax !== prato.listingPriceMin
      ? `R$ ${moeda(prato.listingPriceMin)}–${moeda(prato.listingPriceMax ?? prato.listingPriceMin)} nos canais`
      : `R$ ${moeda(prato.listingPriceMin)} nos canais`);
  }

  partes.push(prato.itemsCount === 0 ? "sem ingredientes" : `${prato.itemsCount} ingrediente${prato.itemsCount === 1 ? "" : "s"}`);
  return partes.join(" · ");
}

/** Diz POR QUE a lista ficou vazia: "nenhum prato com esses filtros" não ajuda a saber qual filtro soltar. */
function explicarListaVazia(filtro: FiltroDaLista, categorias: DishCategory[], pratosDoSeletor: DishListItem[]): string {
  const semCategoria = pratosDoSeletor.filter((prato) => !prato.category).length;
  const nomeDaCategoria = categorias.find((categoria) => categoria.id === filtro.categoriaId)?.name;
  const soCategoria = pratosDoSeletor.filter((prato) => prato.isActive || filtro.mostrarInativos);

  if (filtro.busca === "" && filtro.situacao === "todos" && nomeDaCategoria && !soCategoria.some((prato) => prato.category?.id === filtro.categoriaId || prato.category?.parentId === filtro.categoriaId)) {
    return semCategoria > 0
      ? `Nenhum prato foi classificado em “${nomeDaCategoria}” ainda. ${semCategoria} prato${semCategoria === 1 ? " está" : "s estão"} sem categoria: use “Selecionar vários” e “Organizar” para classificar.`
      : `Nenhum prato foi classificado em “${nomeDaCategoria}” ainda.`;
  }
  if (filtro.categoriaId === FILTRO_SEM_CATEGORIA) return "Todos os pratos já têm categoria.";
  return "Nenhum prato com esses filtros.";
}

export function ListaDePratos({
  pratos, totalCadastrado, contagemDosChips, pratosDoSeletor, categorias, filtro, ordem, selecionadoId, carregando, canEdit, modoSelecao, selecionados,
  onFiltro, onOrdem, onSelecionar, onNovo, onAtualizar, onEntrarNaSelecao, onSairDaSelecao, onAlternarSelecao, onSelecionarTodos,
  onLimparSelecao, onMoverSelecionados, onImprimirSelecionados, onImprimirEmBranco
}: Props) {
  const rolagemRef = useRef<HTMLDivElement>(null);
  const jaRolouPara = useRef<string | null>(null);
  const filtrando = filtro.busca !== "" || filtro.categoriaId !== "" || filtro.situacao !== "todos";
  // Categoria, ordem e inativos ficam recolhidos: a maioria das vezes só se busca e se filtra pela situação.
  const filtrosExtrasAtivos = (filtro.categoriaId !== "" ? 1 : 0) + (ordem !== "nome" ? 1 : 0) + (filtro.mostrarInativos ? 1 : 0);
  const [extrasAbertos, setExtrasAbertos] = useState(filtrosExtrasAtivos > 0);
  const todosDaListaMarcados = pratos.length > 0 && pratos.every((prato) => selecionados.has(prato.id));

  // Prato recém-salvo ou aberto por outro caminho precisa aparecer na lista — uma vez por
  // seleção: rolar a cada tecla da busca puxaria a lista de volta para o prato aberto.
  useEffect(() => {
    if (!selecionadoId) {
      jaRolouPara.current = null;
      return;
    }
    if (jaRolouPara.current === selecionadoId) return;
    const ativo = rolagemRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!ativo) return;
    ativo.scrollIntoView({ block: "nearest" });
    jaRolouPara.current = selecionadoId;
  }, [selecionadoId, pratos]);

  const botaoNovo = (classe: string) => (
    <Button className={classe} leadingIcon={<Plus size={16} aria-hidden />} onClick={onNovo}>Novo prato</Button>
  );

  const cabecalho = (
    <div className="ft-filtros">
      {/* No celular o rodapé da lista fica a centenas de pratos de distância: o botão sobe para o topo. */}
      {canEdit && !modoSelecao && botaoNovo("ft-novo ft-novo--topo")}
      <div className="ft-busca-linha">
        <label className="ft-busca">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={filtro.busca}
            onChange={(event) => onFiltro({ busca: event.target.value })}
            placeholder="Buscar prato, código ou categoria"
            aria-label="Buscar prato, código ou categoria"
            autoComplete="off"
          />
          {filtro.busca && (
            <button type="button" className="ft-busca-limpar" onClick={() => onFiltro({ busca: "" })} aria-label="Limpar busca">
              <X size={14} aria-hidden />
            </button>
          )}
        </label>
        <IconButton
          icon={<RefreshCw size={15} aria-hidden />}
          label="Atualizar custos e pratos"
          size="sm"
          onClick={onAtualizar}
          disabled={carregando}
        />
      </div>

      <div className="ft-chips" role="group" aria-label="Situação da ficha">
        {FILTROS_DE_SITUACAO.map(({ valor, rotulo, chave }) => {
          const quantidade = chave ? contagemDosChips[chave] : contagemDosChips.total;
          return (
            <button
              key={valor}
              type="button"
              className="ft-chip"
              aria-pressed={filtro.situacao === valor}
              onClick={() => onFiltro({ situacao: valor })}
              disabled={valor !== "todos" && quantidade === 0 && filtro.situacao !== valor}
            >
              {rotulo}
              <span className="ft-chip-n">{quantidade}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="ft-extras-botao"
        aria-expanded={extrasAbertos}
        aria-controls="ft-extras"
        onClick={() => setExtrasAbertos((aberto) => !aberto)}
      >
        <SlidersHorizontal size={14} aria-hidden />
        Categoria, ordem e inativos
        {filtrosExtrasAtivos > 0 && <span className="ft-chip-n ft-extras-n">{filtrosExtrasAtivos}</span>}
        <ChevronDown size={14} aria-hidden className={`ft-extras-seta${extrasAbertos ? " ft-extras-seta--aberta" : ""}`} />
      </button>

      {extrasAbertos && (
        <div id="ft-extras" className="ft-extras">
          <div className="ft-selects">
            <Select
              label="Categoria"
              value={filtro.categoriaId}
              onChange={(event) => onFiltro({ categoriaId: event.target.value })}
              options={opcoesDoFiltroDeCategoria(categorias, filtro.menu, filtro.categoriaId, pratosDoSeletor)}
              placeholder="Todas"
            />
            <Select
              label="Ordenar por"
              value={ordem}
              onChange={(event) => onOrdem(event.target.value as OrdemDaLista)}
              options={OPCOES_DE_ORDEM}
            />
          </div>

          <label className="ft-inativos">
            <Switch
              checked={filtro.mostrarInativos}
              onChange={(marcado) => onFiltro({ mostrarInativos: marcado })}
              label="Mostrar pratos inativos"
            />
            <span>Mostrar inativos</span>
          </label>
        </div>
      )}

      {modoSelecao ? (
        <div className="ft-lote-barra" role="group" aria-label="Seleção de pratos">
          <strong>{selecionados.size === 0 ? "Marque os pratos" : `${selecionados.size} prato${selecionados.size === 1 ? "" : "s"} marcado${selecionados.size === 1 ? "" : "s"}`}</strong>
          <div className="ft-lote-links">
            <button type="button" className="ft-lote-botao" onClick={onSelecionarTodos} disabled={pratos.length === 0 || todosDaListaMarcados}>
              Marcar os {pratos.length} da lista
            </button>
            {selecionados.size > 0 && <button type="button" className="ft-lote-botao" onClick={onLimparSelecao}>Desmarcar</button>}
          </div>
          <div className="ft-lote-acoes">
            {canEdit && <Button size="sm" disabled={selecionados.size === 0} onClick={onMoverSelecionados}>Organizar…</Button>}
            <Button size="sm" variant="secondary" leadingIcon={<Printer size={14} aria-hidden />} disabled={selecionados.size === 0} onClick={onImprimirSelecionados}>
              Imprimir fichas
            </Button>
            <Button size="sm" variant="secondary" onClick={onSairDaSelecao}>Concluir</Button>
          </div>
        </div>
      ) : (
        <div className="ft-lote-links">
          <button type="button" className="ft-lote-botao" onClick={onEntrarNaSelecao}>Selecionar vários</button>
          <button type="button" className="ft-lote-botao" onClick={onImprimirEmBranco}>Imprimir ficha em branco</button>
        </div>
      )}
    </div>
  );

  const rodape = canEdit && !modoSelecao ? botaoNovo("ft-novo ft-novo--rodape") : undefined;

  return (
    <div ref={rolagemRef} className="ft-lista-wrap">
      <ListDetailLayout.List className="ft-lista" header={cabecalho} footer={rodape} aria-busy={carregando}>
        {carregando && totalCadastrado === 0 && <p className="ft-lista-aviso">Carregando pratos…</p>}

        {!carregando && totalCadastrado === 0 && (
          <EmptyState
            title="Nenhum prato cadastrado."
            description="Cadastre o primeiro prato e monte a ficha com os ingredientes."
            action={canEdit ? <Button leadingIcon={<Plus size={16} aria-hidden />} onClick={onNovo}>Cadastrar prato</Button> : undefined}
          />
        )}

        {totalCadastrado > 0 && pratos.length === 0 && (
          <div className="ft-lista-aviso">
            <p>{explicarListaVazia(filtro, categorias, pratosDoSeletor)}</p>
            {filtrando && (
              <>
                {filtro.categoriaId !== "" && filtro.categoriaId !== FILTRO_SEM_CATEGORIA && pratosDoSeletor.some((prato) => !prato.category) && (
                  <button type="button" className="ft-link" onClick={() => onFiltro({ categoriaId: FILTRO_SEM_CATEGORIA })}>
                    Ver os pratos sem categoria
                  </button>
                )}
                <button type="button" className="ft-link" onClick={() => onFiltro({ busca: "", categoriaId: "", situacao: "todos" })}>
                  Limpar filtros
                </button>
              </>
            )}
          </div>
        )}

        {pratos.map((prato) => {
          const subtitulo = subtituloDoPrato(prato, filtro.menu === "todos");
          if (!modoSelecao) {
            return (
              <ListDetailLayout.Item
                key={prato.id}
                title={prato.name}
                subtitle={subtitulo}
                active={prato.id === selecionadoId}
                meta={<EtiquetaDoPrato prato={prato} />}
                onClick={() => onSelecionar(prato.id)}
              />
            );
          }
          const marcado = selecionados.has(prato.id);
          return (
            <label key={prato.id} role="listitem" className={`ft-sel-item${marcado ? " ft-sel-item--marcado" : ""}`}>
              <input type="checkbox" checked={marcado} onChange={() => onAlternarSelecao(prato.id)} aria-label={`Marcar ${prato.name}`} />
              <span className="ft-sel-texto">
                <strong>{prato.name}</strong>
                <small>{subtitulo}</small>
              </span>
              <EtiquetaDoPrato prato={prato} />
            </label>
          );
        })}
      </ListDetailLayout.List>
    </div>
  );
}
