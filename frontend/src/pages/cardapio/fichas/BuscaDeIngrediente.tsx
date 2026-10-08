import { Search } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { searchDishProducts, type DishProductSearchResult } from "../../../api/client";
import { Money } from "../../../design-system";

type Props = {
  /** Produtos que já estão na ficha: aparecem marcados, sem impedir de repetir. */
  jaNaFicha: Set<string>;
  onEscolher: (produto: DishProductSearchResult) => void;
};

const ESPERA_DA_DIGITACAO_MS = 250;

/**
 * Caixa de busca de produto com lista navegável por teclado (setas, Enter, Esc).
 * Respostas fora de ordem são descartadas: a busca por "arr" não pode sobrescrever
 * a de "arroz" só porque chegou depois.
 */
export function BuscaDeIngrediente({ jaNaFicha, onEscolher }: Props) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<DishProductSearchResult[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [aberta, setAberta] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  // Termo que gerou `resultados`: Enter só vale quando a lista na tela é a do que está digitado.
  const [termoDosResultados, setTermoDosResultados] = useState("");
  const ultimaBusca = useRef(0);
  const idDaLista = useId();

  const termo = texto.trim();

  useEffect(() => {
    const minha = ++ultimaBusca.current;
    if (!termo) {
      setResultados([]);
      setTermoDosResultados("");
      setBuscando(false);
      setFalhou(false);
      return undefined;
    }

    setBuscando(true);
    const espera = window.setTimeout(async () => {
      try {
        const achados = await searchDishProducts(termo);
        if (minha !== ultimaBusca.current) return;
        setResultados(achados);
        setTermoDosResultados(termo);
        setFalhou(false);
        setIndiceAtivo(0);
      } catch {
        if (minha !== ultimaBusca.current) return;
        setResultados([]);
        setTermoDosResultados(termo);
        setFalhou(true);
      } finally {
        if (minha === ultimaBusca.current) setBuscando(false);
      }
    }, ESPERA_DA_DIGITACAO_MS);

    return () => window.clearTimeout(espera);
  }, [termo]);

  function escolher(produto: DishProductSearchResult) {
    onEscolher(produto);
    setTexto("");
    setResultados([]);
    setAberta(false);
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "Escape") {
      setAberta(false);
      return;
    }
    // Enter dentro do formulário não pode salvar a ficha por acidente, haja ou não resultado.
    if (evento.key === "Enter") evento.preventDefault();
    if (resultados.length === 0) return;

    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setAberta(true);
      setIndiceAtivo((atual) => (atual + 1) % resultados.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setAberta(true);
      setIndiceAtivo((atual) => (atual - 1 + resultados.length) % resultados.length);
    } else if (evento.key === "Enter" && aberta && !buscando && termoDosResultados === termo) {
      escolher(resultados[indiceAtivo]);
    }
  }

  const mostrarLista = aberta && termo !== "";
  const idDaOpcao = (indice: number) => `${idDaLista}-opcao-${indice}`;
  const aviso = buscando
    ? "Buscando…"
    : falhou
      ? "Não foi possível buscar agora. Tente de novo."
      : resultados.length === 0 && termo !== ""
        ? `Nenhum produto encontrado para “${termo}”.`
        : resultados.length > 0
          ? `${resultados.length} produto${resultados.length === 1 ? "" : "s"} encontrado${resultados.length === 1 ? "" : "s"}.`
          : "";

  return (
    <div className="ft-combo">
      <label className="ft-busca ft-busca--grande">
        <Search size={16} aria-hidden />
        <input
          id="ft-busca-ingrediente"
          type="text"
          role="combobox"
          aria-expanded={mostrarLista}
          aria-controls={mostrarLista ? idDaLista : undefined}
          aria-autocomplete="list"
          aria-activedescendant={mostrarLista && resultados.length > 0 ? idDaOpcao(indiceAtivo) : undefined}
          aria-label="Buscar produto para adicionar à ficha"
          placeholder="Buscar produto para adicionar (nome ou código)"
          value={texto}
          autoComplete="off"
          onChange={(evento) => { setTexto(evento.target.value); setAberta(true); }}
          onFocus={() => setAberta(true)}
          onBlur={() => setAberta(false)}
          onKeyDown={aoTeclar}
        />
      </label>

      {/* Leitor de tela: o estado da busca é anunciado sem precisar enxergar a lista. */}
      <p className="ft-so-leitor" role="status" aria-live="polite">{mostrarLista ? aviso : ""}</p>

      {mostrarLista && (
        <ul id={idDaLista} role="listbox" aria-label="Produtos encontrados" className="ft-combo-lista">
          {resultados.map((produto, indice) => {
            const repetido = jaNaFicha.has(produto.id);
            return (
              <li
                key={produto.id}
                id={idDaOpcao(indice)}
                role="option"
                aria-selected={indice === indiceAtivo}
                className={`ft-combo-opcao${indice === indiceAtivo ? " ft-combo-opcao--ativa" : ""}`}
                // mousedown antes do blur do campo: sem isso a lista fecha antes do clique.
                onMouseDown={(evento) => evento.preventDefault()}
                onMouseEnter={() => setIndiceAtivo(indice)}
                onClick={() => escolher(produto)}
              >
                <span className="ft-combo-nome">
                  <strong>{produto.name}</strong>
                  <small>
                    {produto.externalCode ? `${produto.externalCode} · ` : ""}estoque em {produto.unit ?? "—"}
                    {repetido && <em className="ft-combo-repetido"> · já está na ficha</em>}
                  </small>
                </span>
                <span className="ft-combo-custo">
                  {produto.averageCost > 0
                    ? <><Money value={produto.averageCost} />{produto.unit ? ` / ${produto.unit}` : ""}</>
                    : <em className="ft-sem-valor">sem custo médio</em>}
                </span>
              </li>
            );
          })}

          {resultados.length === 0 && (
            <li className="ft-combo-aviso" role="presentation">
              {aviso}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
