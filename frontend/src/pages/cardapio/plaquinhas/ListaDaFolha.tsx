import { ArrowDown, ArrowUp, ListOrdered, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BuffetPlateItem } from "../../../api/client";
import { MAX_QTD, ordenarPorCategoria, type Entrada } from "./plaquinhasFormato";

type Props = {
  entradas: Entrada[];
  porId: Map<string, BuffetPlateItem>;
  /** Chave do prato que acabou de entrar ou ganhar +1: pisca para a pessoa ver onde foi parar. */
  destaque: { chave: string; vez: number } | null;
  onMudar: (fn: (es: Entrada[]) => Entrada[]) => void;
};

const TEMPO_DESFAZER_MS = 6000;

export function ListaDaFolha({ entradas, porId, destaque, onMudar }: Props) {
  const [removida, setRemovida] = useState<{ entrada: Entrada; indice: number } | null>(null);
  const destaqueRef = useRef<HTMLLIElement>(null);

  useEffect(() => { destaqueRef.current?.scrollIntoView({ block: "nearest" }); }, [destaque]);
  useEffect(() => {
    if (!removida) return undefined;
    const t = window.setTimeout(() => setRemovida(null), TEMPO_DESFAZER_MS);
    return () => window.clearTimeout(t);
  }, [removida]);

  const nome = (e: Entrada) => porId.get(e.itemId)?.namePt ?? "Prato removido do catálogo";
  const mudarQtd = (e: Entrada, delta: number) =>
    onMudar((es) => es.map((x) => (x.key === e.key ? { ...x, qty: Math.min(MAX_QTD, Math.max(1, x.qty + delta)) } : x)));
  const mover = (indice: number, delta: number) => onMudar((es) => {
    const alvo = indice + delta;
    if (alvo < 0 || alvo >= es.length) return es;
    const copia = [...es];
    [copia[indice], copia[alvo]] = [copia[alvo], copia[indice]];
    return copia;
  });
  const tirar = (e: Entrada, indice: number) => {
    onMudar((es) => es.filter((x) => x.key !== e.key));
    setRemovida({ entrada: e, indice });
  };
  const desfazer = () => {
    if (!removida) return;
    const { entrada, indice } = removida;
    onMudar((es) => (es.some((x) => x.itemId === entrada.itemId) ? es : [...es.slice(0, indice), entrada, ...es.slice(indice)]));
    setRemovida(null);
  };

  const total = entradas.reduce((a, e) => a + e.qty, 0);
  return (
    <section className="plq-bloco plq-bloco--lista" aria-labelledby="plq-titulo-lista">
      <div className="plq-bloco-cabeca">
        <h3 className="plq-bloco-titulo" id="plq-titulo-lista"><span className="plq-passo">2</span> Pratos na folha</h3>
        <span className="plq-total">{entradas.length} {entradas.length === 1 ? "prato" : "pratos"} · {total} {total === 1 ? "plaquinha" : "plaquinhas"}</span>
      </div>
      {entradas.length > 1 && (
        <button type="button" className="plq-link" onClick={() => onMudar((es) => ordenarPorCategoria(es, porId))}>
          <ListOrdered size={14} aria-hidden="true" /> Ordenar por categoria
        </button>
      )}
      {/* Contêiner sempre montado: leitor de tela só anuncia o que muda dentro de um status já presente. */}
      <div role="status" className="plq-desfazer-area">
        {removida && (
          <div className="plq-desfazer">
            <span><strong>{nome(removida.entrada)}</strong> saiu da folha.</span>
            <button type="button" onClick={desfazer}><Undo2 size={14} aria-hidden="true" /> Desfazer</button>
          </div>
        )}
      </div>
      {entradas.length > 0 && (
        <ol className="plq-entradas">
          {entradas.map((e, i) => {
            const p = porId.get(e.itemId);
            const n = nome(e);
            const realce = e.key === destaque?.chave;
            return (
              <li key={e.key} ref={realce ? destaqueRef : undefined} className={`plq-entrada${realce ? ` plq-entrada--nova plq-entrada--nova-${(destaque?.vez ?? 0) % 2}` : ""}${p ? "" : " plq-entrada--sumiu"}`}>
                <span className="plq-entrada-nome">
                  <strong>{n}</strong>
                  {p && <em>{p.nameEn}</em>}
                </span>
                <span className="plq-qtd" title="Quantas plaquinhas deste prato">
                  <button type="button" aria-label={`Uma plaquinha a menos de ${n}`} disabled={e.qty <= 1} onClick={() => mudarQtd(e, -1)}>−</button>
                  <output aria-label={`Plaquinhas de ${n}`}>{e.qty}</output>
                  <button type="button" aria-label={`Uma plaquinha a mais de ${n}`} disabled={e.qty >= MAX_QTD} onClick={() => mudarQtd(e, 1)}>+</button>
                </span>
                <span className="plq-entrada-acoes">
                  <button type="button" aria-label={`Subir ${n}`} disabled={i === 0} onClick={() => mover(i, -1)}><ArrowUp size={16} /></button>
                  <button type="button" aria-label={`Descer ${n}`} disabled={i === entradas.length - 1} onClick={() => mover(i, 1)}><ArrowDown size={16} /></button>
                  <button type="button" aria-label={`Tirar ${n} da folha`} className="plq-tirar" onClick={() => tirar(e, i)}><X size={16} /></button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
