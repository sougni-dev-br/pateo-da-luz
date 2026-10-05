import { BookPlus, Check, PenLine, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { BuffetPlateItem } from "../../../api/client";
import { arrumarNome, buscarPratos, semAcento } from "./plaquinhasFormato";

const MAX_RESULTADOS = 8;

type Props = {
  catalogo: BuffetPlateItem[];
  /** Nomes (sem acento) que já estão na seção, para marcar em vez de repetir. */
  jaNaSecao: Set<string>;
  podeCadastrar: boolean;
  rotuloSecao: string;
  onEscolher: (prato: { namePt: string; nameEn: string }) => void;
  onCadastrar: (texto: string) => void;
};

type Opcao =
  | { tipo: "catalogo"; prato: BuffetPlateItem }
  | { tipo: "livre"; texto: string }
  | { tipo: "cadastrar"; texto: string };

// Busca do cardápio do display: procura no catálogo (português ou inglês) e, se não achar,
// deixa usar o nome só neste cardápio ou cadastrar no catálogo. ↑/↓ escolhe, Enter adiciona.
export function BuscaPratoCardapio({ catalogo, jaNaSecao, podeCadastrar, rotuloSecao, onEscolher, onCadastrar }: Props) {
  const [texto, setTexto] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [aviso, setAviso] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const idLista = useId();

  const opcoes: Opcao[] = useMemo(() => {
    const t = texto.trim();
    if (t.length < 2) return [];
    const achados = buscarPratos(catalogo, t, null).slice(0, MAX_RESULTADOS);
    const exato = achados.some((p) => semAcento(p.namePt) === semAcento(t));
    const extras: Opcao[] = exato ? [] : [{ tipo: "livre", texto: t }, ...(podeCadastrar ? [{ tipo: "cadastrar", texto: t } as Opcao] : [])];
    return [...achados.map((prato) => ({ tipo: "catalogo", prato }) as Opcao), ...extras];
  }, [texto, catalogo, podeCadastrar]);
  const indice = Math.min(ativo, Math.max(0, opcoes.length - 1));

  useEffect(() => { setAtivo(0); }, [texto]);
  // A lista abre embaixo da busca, onde a barra de botões fica presa: rola até ela aparecer.
  const temOpcoes = opcoes.length > 0;
  useEffect(() => {
    if (temOpcoes) listaRef.current?.scrollIntoView({ block: "nearest" });
  }, [temOpcoes]);
  useEffect(() => {
    if (!aviso) return undefined;
    const t = window.setTimeout(() => setAviso(""), 2500);
    return () => window.clearTimeout(t);
  }, [aviso]);

  function escolher(o: Opcao) {
    if (o.tipo === "cadastrar") { onCadastrar(o.texto); setTexto(""); return; }
    const prato = o.tipo === "catalogo" ? { namePt: o.prato.namePt, nameEn: o.prato.nameEn } : { namePt: arrumarNome(o.texto), nameEn: "" };
    onEscolher(prato);
    setAviso(o.tipo === "livre" ? `${prato.namePt} entrou. Falta escrever o nome em inglês.` : `${prato.namePt} entrou em ${rotuloSecao}.`);
    setTexto("");
    inputRef.current?.focus();
  }

  function tecla(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && opcoes.length) { e.preventDefault(); setAtivo(Math.min(opcoes.length - 1, indice + 1)); }
    else if (e.key === "ArrowUp" && opcoes.length) { e.preventDefault(); setAtivo(Math.max(0, indice - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (opcoes[indice]) escolher(opcoes[indice]); }
    else if (e.key === "Escape" && texto) { e.preventDefault(); setTexto(""); }
  }

  const aberto = opcoes.length > 0;
  const idOpcao = (i: number) => `${idLista}-${i}`;
  return (
    <div className="cdp-busca">
      <div className="plq-busca">
        <Search size={16} aria-hidden="true" />
        <input ref={inputRef} type="text" value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={tecla} autoComplete="off"
          placeholder="Procurar ou escrever um prato" aria-label={`Procurar prato para ${rotuloSecao}`}
          role="combobox" aria-autocomplete="list" aria-expanded={aberto} aria-controls={aberto ? idLista : undefined}
          aria-activedescendant={aberto ? idOpcao(indice) : undefined} />
        {texto && <button type="button" className="plq-busca-limpar" aria-label="Limpar busca" onClick={() => setTexto("")}><X size={15} /></button>}
      </div>
      {aberto && (
        <div ref={listaRef} className="plq-resultados cdp-resultados" id={idLista} role="listbox" aria-label="Pratos encontrados">
          {opcoes.map((o, i) => {
            const classe = `plq-resultado${i === indice ? " plq-resultado--ativo" : ""}${o.tipo !== "catalogo" ? " plq-resultado--novo" : ""}`;
            const comum = { id: idOpcao(i), role: "option", "aria-selected": i === indice, className: classe,
              onMouseEnter: () => setAtivo(i), onMouseDown: (e: MouseEvent) => e.preventDefault(), onClick: () => escolher(o) };
            if (o.tipo === "catalogo") {
              const ja = jaNaSecao.has(semAcento(o.prato.namePt));
              return (
                <div key={o.prato.id} {...comum}>
                  <span><strong>{o.prato.namePt}</strong><em>{o.prato.nameEn}</em></span>
                  {ja ? <small className="plq-ja"><Check size={13} aria-hidden="true" /> já está</small> : <small>{o.prato.category}</small>}
                </div>
              );
            }
            return o.tipo === "livre"
              ? <div key="livre" {...comum}><PenLine size={15} aria-hidden="true" /> Usar “{o.texto}” só neste cardápio</div>
              : <div key="cadastrar" {...comum}><BookPlus size={15} aria-hidden="true" /> Cadastrar “{o.texto}” no catálogo</div>;
          })}
        </div>
      )}
      <p className="plq-anuncio" aria-live="polite">{aviso && <><Check size={14} aria-hidden="true" /> {aviso}</>}</p>
    </div>
  );
}
