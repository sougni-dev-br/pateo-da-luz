import { MessageSquare } from "lucide-react";
import { dataEHora } from "./formatoComentario";
import type { LigacaoDeComentarios } from "./ligacao";
import { contagemDoAno, pontoDoComentario, rotuloCurtoDoPonto, ROTULO_DA_METRICA, ROTULO_DO_TURNO } from "./ponto";

// Bloco do veredito: o que foi escrito sobre o ano inteiro, na íntegra, e a lista dos demais pontos comentados,
// cada um um botão que abre a gaveta naquele ponto.

export function ComentariosDoAno({ ligacao }: { ligacao: LigacaoDeComentarios | undefined }) {
  if (!ligacao || ligacao.todos.length === 0) return null;
  const { anoInteiro, outros } = contagemDoAno(ligacao.todos);
  const total = outros.reduce((soma, o) => soma + o.quantidade, 0);
  return (
    <section className="plan-coment-ano" aria-label="Comentários do comparativo">
      <h3 className="plan-coment-ano-titulo"><MessageSquare size={15} aria-hidden /> Comentários</h3>
      {anoInteiro.map((c) => (
        <div key={c.id} className="plan-coment-ano-item">
          <p className="plan-coment-meta">
            <strong>{ROTULO_DA_METRICA[c.metrica]}{c.turno !== "TOTAL" ? ` · ${ROTULO_DO_TURNO[c.turno]}` : ""}</strong>
            <span>{c.autorNome}, {dataEHora(c.criadoEm)}</span>
          </p>
          <p className="plan-coment-texto">{c.texto}</p>
          <button type="button" className="plan-coment-outro" onClick={() => ligacao.abrir(pontoDoComentario(c))}>Abrir este ponto</button>
        </div>
      ))}
      {outros.length > 0 && (
        <div className="plan-coment-outros">
          <span>Outros {total}:</span>
          {outros.map((o) => (
            <button key={`${o.ponto.mes}|${o.ponto.metrica}|${o.ponto.turno}`} type="button" className="plan-coment-outro" onClick={() => ligacao.abrir(o.ponto)}>
              {rotuloCurtoDoPonto(o.ponto)} ({o.quantidade})
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
