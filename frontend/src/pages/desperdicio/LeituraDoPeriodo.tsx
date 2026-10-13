import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from "lucide-react";
import type { Leitura, Tom } from "./analise";

const ICONE: Record<Tom, typeof Info> = { danger: OctagonAlert, warn: AlertTriangle, info: Info, ok: CheckCircle2 };
const ROTULO: Record<Tom, string> = { danger: "Atenção", warn: "Cuidado", info: "Observação", ok: "Boa notícia" };

type Props = { leituras: Leitura[]; onFiltrar: (leitura: Leitura) => void };

/** O que cabe à vista sem virar parede de texto; o resto fica a um clique. */
const VISIVEIS = 4;

function Item({ leitura, onFiltrar }: { leitura: Leitura; onFiltrar: Props["onFiltrar"] }) {
  const Icone = ICONE[leitura.tom];
  return (
    <li className={`waste-reading-item waste-reading-item--${leitura.tom}`}>
      <Icone size={18} aria-hidden />
      <div>
        <strong><span className="waste-sr">{ROTULO[leitura.tom]}: </span>{leitura.titulo}</strong>
        <p>{leitura.detalhe}</p>
        <p className="waste-reading-action"><span>Primeiro passo:</span> {leitura.acao}</p>
        {leitura.filtro && (
          <button type="button" className="waste-link" onClick={() => onFiltrar(leitura)}>Ver só estes lançamentos</button>
        )}
      </div>
    </li>
  );
}

/** "O que fazer": cada ponto traz a evidência e o primeiro passo; quando há recorte na lista, um clique leva até ele. */
export function LeituraDoPeriodo({ leituras, onFiltrar }: Props) {
  if (leituras.length === 0) return null;
  const principais = leituras.slice(0, VISIVEIS);
  const demais = leituras.slice(VISIVEIS);
  return (
    <section className="waste-reading" aria-labelledby="waste-leitura-titulo">
      <h3 id="waste-leitura-titulo">O que fazer com estes números</h3>
      <ul>
        {principais.map((leitura) => <Item key={leitura.id} leitura={leitura} onFiltrar={onFiltrar} />)}
      </ul>
      {demais.length > 0 && (
        <details className="waste-reading-more">
          <summary>Mais {demais.length} {demais.length === 1 ? "observação" : "observações"}</summary>
          <ul>
            {demais.map((leitura) => <Item key={leitura.id} leitura={leitura} onFiltrar={onFiltrar} />)}
          </ul>
        </details>
      )}
    </section>
  );
}
