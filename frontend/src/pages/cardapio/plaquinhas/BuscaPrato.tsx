import { Check, Plus, Search, X } from "lucide-react";
import { forwardRef, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { BuffetPlateItem } from "../../../api/client";
import { CATEGORIAS, MAX_QTD, buscarPratos } from "./plaquinhasFormato";

type Props = {
  catalogo: BuffetPlateItem[];
  /** Quantas plaquinhas de cada prato já estão na folha. */
  naFolha: Map<string, number>;
  podeCriar: boolean;
  onAdicionar: (itemId: string) => void;
  onNovoPrato: (texto: string, categoria: string | null) => void;
};

// Busca feita para ser usada só no teclado: digita, ↑/↓ escolhe, Enter adiciona e o cursor
// continua na busca para o próximo prato.
export const BuscaPrato = forwardRef<HTMLInputElement, Props>(function BuscaPrato({ catalogo, naFolha, podeCriar, onAdicionar, onNovoPrato }, ref) {
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  const listaRef = useRef<HTMLDivElement>(null);
  // Só rola até o item quando ele foi escolhido pelo teclado: rolar no mouse faz a lista andar sozinha.
  const peloTeclado = useRef(false);

  const resultados = useMemo(() => buscarPratos(catalogo, texto, categoria), [catalogo, texto, categoria]);
  const digitou = texto.trim().length > 2;
  const mostrarNovo = digitou && resultados.length === 0;
  const aberto = resultados.length > 0 || digitou;
  const indiceAtivo = Math.min(ativo, Math.max(0, resultados.length - 1));

  useEffect(() => { setAtivo(0); }, [texto, categoria]);
  useEffect(() => {
    if (!peloTeclado.current) return;
    listaRef.current?.querySelector<HTMLElement>(`[data-indice="${indiceAtivo}"]`)?.scrollIntoView({ block: "nearest" });
  }, [indiceAtivo]);
  useEffect(() => {
    if (!anuncio) return undefined;
    const t = window.setTimeout(() => setAnuncio(""), 2500);
    return () => window.clearTimeout(t);
  }, [anuncio]);

  function adicionar(p: BuffetPlateItem) {
    const antes = naFolha.get(p.id) ?? 0;
    onAdicionar(p.id);
    setAnuncio(antes >= MAX_QTD
      ? `${p.namePt} já está no limite de ${MAX_QTD} plaquinhas`
      : antes > 0 ? `${p.namePt}: agora são ${antes + 1} plaquinhas` : `${p.namePt} entrou na folha`);
    // Busca por categoria continua aberta para adicionar vários seguidos; busca por texto limpa.
    if (texto) setTexto("");
  }

  function tecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && resultados.length) { e.preventDefault(); peloTeclado.current = true; setAtivo(Math.min(resultados.length - 1, indiceAtivo + 1)); }
    else if (e.key === "ArrowUp" && resultados.length) { e.preventDefault(); peloTeclado.current = true; setAtivo(Math.max(0, indiceAtivo - 1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const escolhido = resultados[indiceAtivo];
      if (escolhido) adicionar(escolhido);
      else if (mostrarNovo && podeCriar) onNovoPrato(texto, categoria);
    } else if (e.key === "Escape" && (texto || categoria)) { e.preventDefault(); setTexto(""); setCategoria(null); }
  }

  const idLista = "plq-resultados";
  return (
    <div className="plq-busca-bloco">
      <div className="plq-busca">
        <Search size={18} aria-hidden="true" />
        <input ref={ref} type="text" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={tecla}
          placeholder="Procure o prato: penne, salmão, café…" aria-label="Procurar prato no catálogo" autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded={aberto} aria-controls={aberto ? idLista : undefined}
          aria-activedescendant={aberto && resultados[indiceAtivo] ? `plq-opcao-${resultados[indiceAtivo].id}` : undefined} />
        {(texto || categoria) && (
          <button type="button" className="plq-busca-limpar" aria-label="Limpar busca" onClick={() => { setTexto(""); setCategoria(null); }}><X size={16} /></button>
        )}
      </div>
      <div className="plq-categorias" role="group" aria-label="Ver uma categoria inteira">
        {CATEGORIAS.map((c) => (
          <button key={c} type="button" className="plq-chip" aria-pressed={categoria === c} onClick={() => setCategoria(categoria === c ? null : c)}>{c}</button>
        ))}
      </div>
      {aberto && (
        <div className="plq-resultados">
        <div id={idLista} role="listbox" aria-label="Pratos encontrados" ref={listaRef}>
          {resultados.map((p, i) => {
            const qtd = naFolha.get(p.id) ?? 0;
            return (
              <div key={p.id} id={`plq-opcao-${p.id}`} role="option" aria-selected={i === indiceAtivo} data-indice={i}
                className={`plq-resultado${i === indiceAtivo ? " plq-resultado--ativo" : ""}`}
                onMouseEnter={() => { peloTeclado.current = false; setAtivo(i); }} onMouseDown={(e) => e.preventDefault()} onClick={() => adicionar(p)}>
                <span><strong>{p.namePt}</strong><em>{p.nameEn}</em></span>
                {qtd > 0 ? <small className="plq-ja"><Check size={14} aria-hidden="true" /> {qtd} na folha</small> : <small>{p.category}</small>}
              </div>
            );
          })}
        </div>
          {mostrarNovo && (podeCriar
            ? <button type="button" className="plq-resultado plq-resultado--novo" onClick={() => onNovoPrato(texto, categoria)}><Plus size={16} /> Cadastrar “{texto.trim()}” como prato novo <kbd>Enter</kbd></button>
            : <p className="plq-contagem plq-resultado-vazio">Nenhum prato com esse nome no catálogo.</p>)}
        </div>
      )}
      <p className="plq-anuncio" aria-live="polite">{anuncio && <><Check size={14} aria-hidden="true" /> {anuncio}</>}</p>
    </div>
  );
});
