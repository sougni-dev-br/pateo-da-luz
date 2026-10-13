import type { WasteGroup, WasteSummary } from "../../api/client";
import { Money } from "../../design-system";
import { formatNumber } from "../../utils/format";

function valorDoGrupo(grupo: WasteGroup, comValor: boolean) {
  if (!comValor || typeof grupo.valor !== "number") return `${grupo.lancamentos}×`;
  return grupo.semCusto === grupo.lancamentos ? "sem custo" : <Money value={grupo.valor} />;
}

function Grupo({ titulo, grupos, comValor }: { titulo: string; grupos: WasteGroup[]; comValor: boolean }) {
  if (grupos.length === 0) return null;
  const medida = (g: WasteGroup) => (comValor && typeof g.valor === "number" ? g.valor : g.lancamentos);
  const maior = Math.max(...grupos.map(medida), 1);
  return (
    <section className="waste-group">
      <h3>{titulo}</h3>
      <ul>
        {grupos.slice(0, 6).map((grupo) => (
          <li key={grupo.chave}>
            <div className="waste-group-row">
              <span>{grupo.nome}</span>
              <strong>{valorDoGrupo(grupo, comValor)}</strong>
            </div>
            <div className="waste-bar" aria-hidden><span style={{ width: `${Math.max((medida(grupo) / maior) * 100, 2)}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Props = { resumo: WasteSummary; veCusto: boolean };

/** Totais do período. O R$ só aparece para quem vê custos; os demais veem quantos lançamentos. */
export function ResumoDoPeriodo({ resumo, veCusto }: Props) {
  const mostraValor = veCusto && typeof resumo.total.valor === "number";
  return (
    <>
      <dl className="waste-kpis">
        <div>
          <dt>Lançamentos</dt>
          <dd>{formatNumber(resumo.total.lancamentos)}</dd>
        </div>
        {mostraValor && (
          <div>
            <dt>Valor desperdiçado</dt>
            <dd><Money value={resumo.total.valor ?? 0} /></dd>
          </div>
        )}
      </dl>
      {mostraValor && resumo.total.semCusto > 0 && (
        <p className="waste-note">{resumo.total.semCusto} lançamento(s) sem custo conhecido não entram no valor.</p>
      )}
      <div className="waste-groups">
        <Grupo titulo="Por motivo" grupos={resumo.porMotivo} comValor={veCusto} />
        <Grupo titulo="Por setor" grupos={resumo.porSetor} comValor={veCusto} />
        <Grupo titulo="Quem mais perde" grupos={resumo.porProduto} comValor={veCusto} />
      </div>
    </>
  );
}
