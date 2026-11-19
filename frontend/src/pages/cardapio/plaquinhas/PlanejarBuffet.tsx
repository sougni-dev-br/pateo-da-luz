import { useMemo, useState } from "react";
import type { BuffetAnalysisItem } from "../../../api/client";
import { Alert, Button, Money, TextField } from "../../../design-system";
import { FOLGA_PADRAO_PCT, MAX_FOLGA_PCT, MAX_PESSOAS, MIN_DIAS_PARA_PLANEJAR, lerNumero, planejarBuffet } from "./planoDoBuffet";

type Props = {
  itens: BuffetAnalysisItem[];
  /** Pratos do dia pesado mais recente: o cardápio atual, que vem marcado no início. */
  cardapioAtual: string[];
  /** Média de pessoas por dia no período, para sugerir o número inicial. */
  pessoasMedia: number | null;
  costVisible: boolean;
};

const kgBr = (kg: number) => `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;

// "Quanto fazer de cada prato para N pessoas": o consumo médio por pessoa dos dias pesados, mais uma folga.
// O total só soma os pratos MARCADOS: somar todo o rodízio do período multiplicaria o buffet várias vezes.
export function PlanejarBuffet({ itens, cardapioAtual, pessoasMedia, costVisible }: Props) {
  const [pessoasTxt, setPessoasTxt] = useState(pessoasMedia ? String(pessoasMedia) : "");
  const [folgaTxt, setFolgaTxt] = useState(String(FOLGA_PADRAO_PCT));
  const pessoas = lerNumero(pessoasTxt);
  const folga = lerNumero(folgaTxt);
  const pessoasOk = pessoas !== null && pessoas > 0 && pessoas <= MAX_PESSOAS;
  const folgaOk = folga !== null && folga <= MAX_FOLGA_PCT;

  // Todos os pratos com histórico, para o cardápio ser escolhido; o total vem só dos marcados.
  const completo = useMemo(() => (pessoasOk && folgaOk ? planejarBuffet(itens, pessoas, folga) : null), [itens, pessoas, folga, pessoasOk, folgaOk]);
  const elegiveis = useMemo(() => new Set((completo?.rows ?? []).map((r) => r.itemId)), [completo]);
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(cardapioAtual));
  const marcadosValidos = useMemo(() => itens.filter((i) => marcados.has(i.itemId)), [itens, marcados]);
  const plano = useMemo(() => (pessoasOk && folgaOk ? planejarBuffet(marcadosValidos, pessoas, folga) : null), [marcadosValidos, pessoas, folga, pessoasOk, folgaOk]);

  const alternar = (id: string) => setMarcados((atual) => { const novo = new Set(atual); if (novo.has(id)) novo.delete(id); else novo.add(id); return novo; });
  const marcar = (ids: string[]) => setMarcados(new Set(ids));
  const erroDeCampo = !pessoasOk ? "Informe as pessoas esperadas (de 1 a " + MAX_PESSOAS + ")." : !folgaOk ? `Informe a folga de 0 a ${MAX_FOLGA_PCT}%.` : null;

  return (
    <section className="plq-bloco" aria-labelledby="res-plano">
      <h3 className="plq-bloco-titulo" id="res-plano">Planejar o próximo buffet</h3>
      <p className="plq-contagem">
        Quanto fazer de cada prato, pelo que cada pessoa consumiu nos dias pesados. Marque os pratos do cardápio que vai servir:
        só eles entram no total. Pratos precisam de pelo menos {MIN_DIAS_PARA_PLANEJAR} dias de sobra pesada com pessoas no PDV.
      </p>
      <div className="plq-campos">
        <TextField label="Pessoas esperadas" inputMode="numeric" value={pessoasTxt} onChange={(e) => setPessoasTxt(e.target.value)}
          error={pessoasTxt && !pessoasOk ? `Informe de 1 a ${MAX_PESSOAS}` : undefined} hint={pessoasMedia ? `Média do período: ${pessoasMedia}` : undefined} />
        <TextField label="Folga de segurança (%)" inputMode="decimal" value={folgaTxt} onChange={(e) => setFolgaTxt(e.target.value)}
          error={folgaTxt && !folgaOk ? `Informe de 0 a ${MAX_FOLGA_PCT}` : undefined} hint="Acima do consumo médio, para não faltar" />
      </div>

      {!completo ? <p className="plq-vazio">{erroDeCampo}</p> : completo.rows.length === 0 ? (
        <Alert tone="info">Ainda não há pratos com histórico suficiente. Continue pesando a produção e a sobra: o plano aparece com {MIN_DIAS_PARA_PLANEJAR} ou mais dias de sobra pesada.</Alert>
      ) : (
        <>
          <div className="pes-ficha-acoes" role="group" aria-label="Escolher pratos do plano">
            <Button size="sm" variant="secondary" onClick={() => marcar(cardapioAtual.filter((id) => elegiveis.has(id)))}>Só o último cardápio</Button>
            <Button size="sm" variant="secondary" onClick={() => marcar([...elegiveis])}>Todos</Button>
            <Button size="sm" variant="secondary" onClick={() => marcar([])}>Nenhum</Button>
          </div>
          {plano && plano.rows.length > 0 ? (
            <p className="pes-total" data-testid="res-plano-total">
              Para <strong>{pessoas}</strong> pessoas, com {plano.rows.length} prato{plano.rows.length === 1 ? "" : "s"}: <strong>{kgBr(plano.totalKg)}</strong> de comida
              {costVisible && plano.totalCost !== null && <> · custo previsto <strong><Money value={plano.totalCost} /></strong> (<Money value={plano.totalCost / (pessoas as number)} /> por pessoa)</>}
              {costVisible && plano.withCost < plano.rows.length && <small className="pes-aviso-custo"> — só {plano.withCost} de {plano.rows.length} pratos têm custo</small>}
            </p>
          ) : <p className="plq-contagem" data-testid="res-plano-vazio">Nenhum prato marcado. Marque os pratos que vai servir para ver o total.</p>}
          <div className="pes-tabela-rolagem">
            <table className="pes-tabela">
              <thead><tr><th>Servir</th><th>Prato</th><th>Fazer</th><th>g por pessoa</th>{costVisible && <th>Custo</th>}</tr></thead>
              <tbody>
                {completo.rows.map((r) => (
                  <tr key={r.itemId}>
                    <td><input type="checkbox" checked={marcados.has(r.itemId)} aria-label={`Servir ${r.name}`} onChange={() => alternar(r.itemId)} /></td>
                    <td>{r.name}{r.canFallShort && <small className="pes-aviso-custo"> — quase não sobra: pode ter acabado, considere fazer um pouco mais</small>}</td>
                    <td><strong>{kgBr(r.kg)}</strong></td>
                    <td>{r.gPerPerson} g</td>
                    {costVisible && <td>{r.cost === null ? <small>sem custo</small> : <Money value={r.cost} />}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {completo && completo.left.length > 0 && (
        <details className="pes-lancamentos">
          <summary>{completo.left.length} prato{completo.left.length === 1 ? "" : "s"} sem histórico suficiente (fora do plano)</summary>
          <ul><li>{completo.left.map((l) => l.name).join(", ")}</li></ul>
        </details>
      )}
    </section>
  );
}
