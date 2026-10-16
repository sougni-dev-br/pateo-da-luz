import { Search, X } from "lucide-react";
import { forwardRef } from "react";
import type { Visao } from "./catalogo";

export type OpcaoDeLocal = { id: string; nome: string; total: number };

type Props = {
  texto: string;
  onTexto: (valor: string) => void;
  locais: OpcaoDeLocal[];
  localId: string | null;
  onLocal: (id: string | null) => void;
  visao: Visao;
  onVisao: (visao: Visao) => void;
  totalDeProdutos: number;
  escolhidos: number;
  comProblema: number;
  mostrarSemSaldo: boolean;
  onMostrarSemSaldo: (valor: boolean) => void;
};

/** Busca, local do estoque e visão (tudo / escolhidos / com problema): fica grudado no topo enquanto a lista rola. */
export const FiltrosDoCatalogo = forwardRef<HTMLInputElement, Props>(function FiltrosDoCatalogo(props, ref) {
  const { texto, onTexto, locais, localId, onLocal, visao, onVisao, totalDeProdutos, escolhidos, comProblema, mostrarSemSaldo, onMostrarSemSaldo } = props;
  return (
    <>
      <div className="rq-fixos">
      <div className="rq-busca">
        <Search size={18} aria-hidden />
        <input
          ref={ref}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          placeholder="Buscar produto ou código"
          aria-label="Buscar produto ou código"
          value={texto}
          onChange={(e) => onTexto(e.target.value)}
        />
        {texto && (
          <button type="button" className="rq-busca-limpar" aria-label="Limpar busca" onClick={() => onTexto("")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="rq-chips" role="group" aria-label="O que mostrar">
        <button type="button" aria-pressed={visao === "TODOS"} className={visao === "TODOS" ? "is-ativo" : undefined} onClick={() => onVisao("TODOS")}>
          Produtos <span className="rq-chip-n">{totalDeProdutos}</span>
        </button>
        <button type="button" aria-pressed={visao === "ESCOLHIDOS"} className={visao === "ESCOLHIDOS" ? "is-ativo" : undefined} onClick={() => onVisao("ESCOLHIDOS")}>
          Escolhidos <span className="rq-chip-n">{escolhidos}</span>
        </button>
        {(comProblema > 0 || visao === "PROBLEMA") && (
          <button type="button" aria-pressed={visao === "PROBLEMA"} className={`is-problema${visao === "PROBLEMA" ? " is-ativo" : ""}`} onClick={() => onVisao("PROBLEMA")}>
            Com problema <span className="rq-chip-n">{comProblema}</span>
          </button>
        )}
      </div>

      </div>

      {visao === "TODOS" && (
        <div className="rq-extras">
          <div className="rq-chips rq-locais" role="group" aria-label="Local do estoque">
            <button type="button" aria-pressed={localId === null} className={localId === null ? "is-ativo" : undefined} onClick={() => onLocal(null)}>Todos os locais</button>
            {locais.map((local) => (
              <button key={local.id} type="button" aria-pressed={localId === local.id} className={localId === local.id ? "is-ativo" : undefined} onClick={() => onLocal(localId === local.id ? null : local.id)}>
                {local.nome} <span className="rq-chip-n">{local.total}</span>
              </button>
            ))}
          </div>
          <label className="rq-opcao">
            <input type="checkbox" checked={mostrarSemSaldo} onChange={(e) => onMostrarSemSaldo(e.target.checked)} />
            Mostrar também produtos sem saldo
          </label>
        </div>
      )}
    </>
  );
});
