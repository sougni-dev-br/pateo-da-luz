import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import type { RefObject } from "react";
import type { Supplier } from "../../api/client";
import { Select, TextField } from "../../design-system";
import type { PeriodPreset, PeriodState } from "../../utils/period";
import type { FaixaVencimento } from "./vencimento";

export type OrdenacaoCompras = "recent" | "oldest" | "highest" | "lowest" | "dueSoon";

const OPCOES_PERIODO = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7", label: "Últimos 7 dias" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "currentMonth", label: "Mês atual" },
  { value: "previousMonth", label: "Mês anterior" },
  { value: "currentYear", label: "Ano atual" },
  { value: "custom", label: "Período personalizado" }
];

const OPCOES_SITUACAO = [
  { value: "", label: "Ativas" },
  { value: "true", label: "Todas (com canceladas)" },
  { value: "cancelled", label: "Somente canceladas" }
];

const OPCOES_ORDENACAO: Array<{ value: OrdenacaoCompras; label: string }> = [
  { value: "recent", label: "Compra mais recente" },
  { value: "oldest", label: "Compra mais antiga" },
  { value: "dueSoon", label: "Vencimento mais próximo" },
  { value: "highest", label: "Maior valor" },
  { value: "lowest", label: "Menor valor" }
];

const SEGMENTOS: Array<{ faixa: FaixaVencimento; rotulo: string }> = [
  { faixa: "todas", rotulo: "Todas" },
  { faixa: "abertas", rotulo: "Em aberto" },
  { faixa: "vencidas", rotulo: "Vencidas" },
  { faixa: "pagas", rotulo: "Pagas" }
];

const ATALHOS_FAIXA: Array<{ faixa: FaixaVencimento; rotulo: string }> = [
  { faixa: "vence7", rotulo: "Vencem em 7 dias" },
  { faixa: "sem", rotulo: "Sem vencimento" }
];

const ATALHOS_PERIODO: Array<{ preset: PeriodPreset; rotulo: string }> = [
  { preset: "currentMonth", rotulo: "Mês atual" },
  { preset: "previousMonth", rotulo: "Mês anterior" },
  { preset: "currentYear", rotulo: "Ano atual" }
];

export type FornecedorFiltro = {
  consulta: string;
  aberto: boolean;
  containerRef: RefObject<HTMLDivElement>;
  opcoes: Supplier[];
  onConsulta: (valor: string) => void;
  onAbrir: () => void;
  onEscolher: (id: string) => void;
  onLimpar: () => void;
};

type Props = {
  busca: string;
  onBusca: (valor: string) => void;
  painelAberto: boolean;
  onAlternarPainel: () => void;
  qtdAtivos: number;
  onLimpar: () => void;
  periodo: PeriodState;
  onPeriodo: (preset: PeriodPreset) => void;
  onData: (campo: "startDate" | "endDate", valor: string) => void;
  fornecedor: FornecedorFiltro;
  categorias: string[];
  categoria: string;
  onCategoria: (valor: string) => void;
  situacao: string;
  onSituacao: (valor: string) => void;
  forma: string;
  onForma: (valor: string) => void;
  ordenacao: OrdenacaoCompras;
  onOrdenacao: (valor: OrdenacaoCompras) => void;
  faixa: FaixaVencimento;
  onFaixa: (faixa: FaixaVencimento) => void;
};

/** Busca, filtros avançados (recolhíveis) e atalhos de vencimento e período. */
export function FiltrosCompras(props: Props) {
  const { busca, painelAberto, qtdAtivos, periodo, fornecedor, faixa } = props;
  return (
    <>
      <div className="cp-barra">
        <div className="cp-busca">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar compras"
            placeholder="Buscar NF, pedido, fornecedor, CNPJ, produto ou valor…"
            value={busca}
            onChange={(e) => props.onBusca(e.target.value)}
          />
          {busca && (
            <button type="button" className="cp-busca-limpar" onClick={() => props.onBusca("")} aria-label="Limpar busca">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          className={`cp-botao-filtros${qtdAtivos > 0 ? " cp-botao-filtros--ativo" : ""}`}
          aria-expanded={painelAberto}
          aria-controls="cp-filtros-avancados"
          onClick={props.onAlternarPainel}
        >
          <SlidersHorizontal size={15} aria-hidden="true" />
          Filtros
          {qtdAtivos > 0 && <span className="cp-contador" aria-label={`${qtdAtivos} ativos`}>{qtdAtivos}</span>}
        </button>
        {(qtdAtivos > 0 || busca) && (
          <button type="button" className="cp-link" onClick={props.onLimpar}>Limpar</button>
        )}
      </div>

      {painelAberto && (
        <div id="cp-filtros-avancados" className="cp-filtros" role="group" aria-label="Filtros avançados">
          <Select
            label="Período da compra"
            value={periodo.preset}
            onChange={(e) => props.onPeriodo(e.target.value as PeriodPreset)}
            options={OPCOES_PERIODO}
          />
          {periodo.preset === "custom" && (
            <>
              <TextField label="Data inicial" type="date" value={periodo.startDate} onChange={(e) => props.onData("startDate", e.target.value)} />
              <TextField label="Data final" type="date" value={periodo.endDate} onChange={(e) => props.onData("endDate", e.target.value)} />
            </>
          )}
          <div className="cp-fornecedor" ref={fornecedor.containerRef}>
            <label className="ds-text-field">
              <span className="ds-text-field-label">Fornecedor</span>
              <div className={`autocomplete-shell${fornecedor.aberto ? " active" : ""}`}>
                <input
                  className="ds-text-field-input"
                  autoComplete="off"
                  name="purchase-supplier-filter"
                  placeholder="Nome, código ou CNPJ/CPF"
                  value={fornecedor.consulta}
                  onChange={(e) => fornecedor.onConsulta(e.target.value)}
                  onFocus={fornecedor.onAbrir}
                />
                {fornecedor.consulta && (
                  <button className="autocomplete-clear" type="button" aria-label="Limpar fornecedor" onClick={fornecedor.onLimpar}>
                    <X size={14} />
                  </button>
                )}
                <ChevronDown size={16} className="autocomplete-chevron" />
              </div>
            </label>
            {fornecedor.aberto && (
              <div className="autocomplete-dropdown">
                {fornecedor.opcoes.length === 0 && (
                  <div className="autocomplete-empty">Nenhum fornecedor encontrado. Verifique o código, nome ou CNPJ.</div>
                )}
                {fornecedor.opcoes.map((s) => (
                  <button key={s.id} className="autocomplete-option" type="button" onClick={() => fornecedor.onEscolher(s.id)}>
                    <strong>{s.externalCode ? `${s.externalCode} • ` : ""}{s.name}</strong>
                    <small>{s.document || "Sem documento"}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Select
            label="Categoria"
            value={props.categoria}
            onChange={(e) => props.onCategoria(e.target.value)}
            placeholder="Todas"
            options={props.categorias.map((c) => ({ value: c, label: c }))}
          />
          <TextField
            label="Forma de pagamento"
            autoComplete="off"
            placeholder="PIX, boleto, cartão…"
            value={props.forma}
            onChange={(e) => props.onForma(e.target.value)}
          />
          <Select label="Situação" value={props.situacao} onChange={(e) => props.onSituacao(e.target.value)} options={OPCOES_SITUACAO} />
          <Select
            label="Ordenação"
            value={props.ordenacao}
            onChange={(e) => props.onOrdenacao(e.target.value as OrdenacaoCompras)}
            options={OPCOES_ORDENACAO}
          />
        </div>
      )}

      <div className="cp-vistas">
        <div className="cp-segmento" role="group" aria-label="Situação do pagamento">
          {SEGMENTOS.map((s) => (
            <button key={s.faixa} type="button" aria-pressed={faixa === s.faixa} onClick={() => props.onFaixa(s.faixa)}>
              {s.rotulo}
            </button>
          ))}
        </div>
        <div className="cp-atalhos" role="group" aria-label="Atalhos">
          {ATALHOS_FAIXA.map((a) => (
            <button key={a.faixa} type="button" className="cp-chip" aria-pressed={faixa === a.faixa} onClick={() => props.onFaixa(faixa === a.faixa ? "todas" : a.faixa)}>
              {a.rotulo}
            </button>
          ))}
          {ATALHOS_PERIODO.map((a) => (
            <button key={a.preset} type="button" className="cp-chip" aria-pressed={periodo.preset === a.preset} onClick={() => props.onPeriodo(a.preset)}>
              {a.rotulo}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
