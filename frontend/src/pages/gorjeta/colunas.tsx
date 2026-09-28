import { Columns3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// Ocultar colunas: cada tabela tem sua lista de colunas escondidas, guardada
// neste navegador. O nome do funcionário nunca some — é a referência da linha.

export type ColunaOpcional = { chave: string; rotulo: string };

function ler(armazenamento: string): Set<string> {
  try {
    const lista = JSON.parse(window.localStorage.getItem(armazenamento) ?? "[]") as unknown;
    return new Set(Array.isArray(lista) ? lista.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function useColunas(chave: string) {
  const armazenamento = `gorjeta-colunas:${chave}`;
  const [ocultas, setOcultas] = useState<Set<string>>(() => ler(armazenamento));

  function gravar(novas: Set<string>) {
    setOcultas(novas);
    try { window.localStorage.setItem(armazenamento, JSON.stringify([...novas])); } catch { /* só não lembra */ }
  }

  return {
    ocultas,
    visivel: (coluna: string) => !ocultas.has(coluna),
    alternar: (coluna: string) => {
      const novas = new Set(ocultas);
      if (novas.has(coluna)) novas.delete(coluna); else novas.add(coluna);
      gravar(novas);
    },
    mostrarTodas: () => gravar(new Set()),
  };
}

type SeletorProps = {
  colunas: ColunaOpcional[];
  ocultas: Set<string>;
  alternar: (coluna: string) => void;
  mostrarTodas: () => void;
};

export function SeletorColunas({ colunas, ocultas, alternar, mostrarTodas }: SeletorProps) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const escondidas = colunas.filter((c) => ocultas.has(c.chave)).length;

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="seletor-colunas">
      <button type="button" className="barra-lista-botao" aria-expanded={aberto} aria-haspopup="true"
        onClick={() => setAberto((v) => !v)} title="Mostrar ou ocultar colunas">
        <Columns3 size={14} aria-hidden />
        Colunas
        {escondidas > 0 && <span className="seletor-colunas-contagem">{escondidas} oculta{escondidas > 1 ? "s" : ""}</span>}
      </button>
      {aberto && (
        <div className="seletor-colunas-painel" role="group" aria-label="Colunas visíveis">
          {colunas.map((c) => (
            <label key={c.chave}>
              <input type="checkbox" checked={!ocultas.has(c.chave)} onChange={() => alternar(c.chave)} />
              {c.rotulo}
            </label>
          ))}
          <div className="seletor-colunas-rodape">
            <button type="button" className="barra-lista-link" onClick={mostrarTodas} disabled={escondidas === 0}>Mostrar todas</button>
          </div>
        </div>
      )}
    </div>
  );
}
