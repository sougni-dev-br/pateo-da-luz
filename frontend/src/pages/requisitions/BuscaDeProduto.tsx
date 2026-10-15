import { Search } from "lucide-react";
import { forwardRef, useEffect, useRef, useState } from "react";
import { searchRequisitionProducts, type RequisitionProductHit } from "../../api/client";
import { formatarQuantidade } from "../desperdicio/quantidade";

type Props = {
  /** Produtos já na lista: aparecem marcados e não se repetem. */
  jaNaLista: Set<string>;
  saldos: Map<string, number> | null;
  onEscolher: (produto: RequisitionProductHit) => void;
};

const ESPERA_DA_BUSCA_MS = 200;

export const BuscaDeProduto = forwardRef<HTMLInputElement, Props>(function BuscaDeProduto({ jaNaLista, saldos, onEscolher }, ref) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<RequisitionProductHit[]>([]);
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const ultimaBusca = useRef(0);

  useEffect(() => {
    const termo = texto.trim();
    if (!termo) {
      setResultados([]);
      setBuscando(false);
      setFalhou(false);
      return;
    }
    const numero = ++ultimaBusca.current;
    setBuscando(true);
    const espera = setTimeout(() => {
      searchRequisitionProducts(termo)
        .then((lista) => {
          if (numero !== ultimaBusca.current) return;
          setResultados(lista);
          setDestaque(0);
          setFalhou(false);
        })
        .catch(() => {
          if (numero === ultimaBusca.current) setFalhou(true);
        })
        .finally(() => {
          if (numero === ultimaBusca.current) setBuscando(false);
        });
    }, ESPERA_DA_BUSCA_MS);
    return () => clearTimeout(espera);
  }, [texto]);

  function escolher(produto: RequisitionProductHit) {
    onEscolher(produto);
    setTexto("");
    setResultados([]);
    setAberto(false);
  }

  return (
    <div className="req-busca">
      <div className="filter-input-wrap">
        <Search size={16} aria-hidden />
        <input
          ref={ref}
          type="search"
          role="combobox"
          aria-expanded={aberto}
          aria-controls="req-busca-lista"
          aria-label="Buscar produto para adicionar"
          placeholder="Buscar produto por nome ou código…"
          value={texto}
          autoComplete="off"
          onChange={(e) => {
            setTexto(e.target.value);
            setAberto(true);
          }}
          onFocus={() => texto.trim() && setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 180)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setDestaque((d) => Math.min(d + 1, Math.max(resultados.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setDestaque((d) => Math.max(d - 1, 0));
            } else if (e.key === "Enter" && resultados[destaque]) {
              e.preventDefault();
              escolher(resultados[destaque]);
            } else if (e.key === "Escape") {
              setAberto(false);
              setTexto("");
            }
          }}
        />
      </div>
      {aberto && texto.trim() && (
        <ul className="req-dropdown" id="req-busca-lista" role="listbox">
          {resultados.map((produto, indice) => {
            const saldo = saldos?.get(produto.id);
            const repetido = jaNaLista.has(produto.id);
            const semSaldo = saldos != null && (saldo ?? 0) <= 0;
            return (
              <li key={produto.id} role="option" aria-selected={indice === destaque}>
                <button
                  type="button"
                  className={`req-dropdown-item${indice === destaque ? " is-ativo" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    escolher(produto);
                  }}
                >
                  <span className="req-dropdown-nome">
                    <strong>{produto.name}</strong>
                    <small>{[produto.code && `Cód. ${produto.code}`, produto.unit].filter(Boolean).join(" · ")}</small>
                  </span>
                  {repetido ? (
                    <span className="req-stock-badge warning">já na lista</span>
                  ) : saldos != null ? (
                    <span className={`req-stock-badge ${semSaldo ? "danger" : "ok"}`}>
                      {semSaldo ? "sem saldo" : `${formatarQuantidade(saldo ?? 0)} ${produto.unit ?? ""}`}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {resultados.length === 0 && (
            <li className="req-dropdown-vazio">{buscando ? "Buscando…" : falhou ? "Não consegui buscar agora. Tente de novo." : `Nenhum produto encontrado para “${texto.trim()}”.`}</li>
          )}
        </ul>
      )}
    </div>
  );
});
