import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Table, type TableThProps } from "../../design-system";

// Ordenação estilo Excel: clicar no cabeçalho alterna crescente → decrescente →
// ordem original. A escolha fica guardada neste navegador (por tabela), para a
// conferência continuar do mesmo jeito ao recarregar.

export type Direcao = "asc" | "desc";
export type Ordem = { coluna: string; direcao: Direcao } | null;
export type Valor = string | number | null | undefined;
export type Extratores<T> = Record<string, (item: T) => Valor>;

function lerOrdem(chave: string): Ordem {
  try {
    const bruto = window.localStorage.getItem(chave);
    if (!bruto) return null;
    const o = JSON.parse(bruto) as Ordem;
    return o && typeof o.coluna === "string" && (o.direcao === "asc" || o.direcao === "desc") ? o : null;
  } catch {
    return null;
  }
}

function gravarOrdem(chave: string, ordem: Ordem) {
  try {
    if (ordem) window.localStorage.setItem(chave, JSON.stringify(ordem));
    else window.localStorage.removeItem(chave);
  } catch {
    // Sem armazenamento (janela anônima etc.): a ordenação só não é lembrada.
  }
}

export function useOrdenacao(chave: string) {
  const armazenamento = `gorjeta-ordem:${chave}`;
  const [ordem, setOrdemState] = useState<Ordem>(() => lerOrdem(armazenamento));

  function definir(nova: Ordem) {
    setOrdemState(nova);
    gravarOrdem(armazenamento, nova);
  }

  // Números começam do maior (o que mais se quer conferir); texto começa do A.
  function alternar(coluna: string, primeiro: Direcao = "asc") {
    if (!ordem || ordem.coluna !== coluna) return definir({ coluna, direcao: primeiro });
    if (ordem.direcao === primeiro) return definir({ coluna, direcao: primeiro === "asc" ? "desc" : "asc" });
    definir(null);
  }

  return { ordem, alternar, definir };
}

function comparar(a: Valor, b: Valor): number {
  const vazioA = a == null || a === "";
  const vazioB = b == null || b === "";
  if (vazioA || vazioB) return vazioA === vazioB ? 0 : vazioA ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

// Estável: empate mantém a ordem original. Vazios vão sempre para o fim.
export function aplicarOrdem<T>(lista: T[], ordem: Ordem, extratores: Extratores<T>): T[] {
  if (!ordem) return lista;
  const extrair = extratores[ordem.coluna];
  if (!extrair) return lista;
  const sinal = ordem.direcao === "asc" ? 1 : -1;
  return lista
    .map((item, i) => ({ item, i, v: extrair(item) }))
    .sort((x, y) => {
      const vazioX = x.v == null || x.v === "";
      const vazioY = y.v == null || y.v === "";
      if (vazioX !== vazioY) return vazioX ? 1 : -1;
      return comparar(x.v, y.v) * sinal || x.i - y.i;
    })
    .map((x) => x.item);
}

type ThOrdenavelProps = Omit<TableThProps, "children"> & {
  coluna: string;
  ordem: Ordem;
  onOrdenar: (coluna: string, primeiro: Direcao) => void;
  /** Direção do primeiro clique: "desc" para valores (maior primeiro). */
  primeiro?: Direcao;
  children: ReactNode;
};

export function ThOrdenavel({ coluna, ordem, onOrdenar, primeiro = "asc", children, align, style, ...rest }: ThOrdenavelProps) {
  const ativa = ordem?.coluna === coluna ? ordem.direcao : null;
  const Icone = ativa === "asc" ? ArrowUp : ativa === "desc" ? ArrowDown : ArrowUpDown;
  const rotulo = typeof children === "string" ? children : coluna;
  return (
    <Table.Th
      className="th-ordenavel"
      align={align}
      aria-sort={ativa === "asc" ? "ascending" : ativa === "desc" ? "descending" : "none"}
      style={{ ...style, padding: 0 }}
      {...rest}
    >
      <button
        type="button"
        onClick={() => onOrdenar(coluna, primeiro)}
        title={`Ordenar por ${rotulo}${ativa ? (ativa === "asc" ? " (crescente)" : " (decrescente)") : ""}`}
        style={{
          all: "unset", boxSizing: "border-box", cursor: "pointer", width: "100%", padding: "6px 8px",
          display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
          justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
          color: ativa ? "var(--ink)" : undefined,
        }}
      >
        {children}
        <Icone size={12} aria-hidden className="th-ordenavel-icone" data-ativa={ativa ? "" : undefined} />
      </button>
    </Table.Th>
  );
}
