import type { AnaliseDemanda } from "../../api/client";
import { decimal1, ORDEM_SEMANA } from "./formato";

// Média de pessoas por dia observado, por dia da semana (linhas) e hora (colunas). A intensidade é
// relativa à célula mais cheia do próprio período; o número dentro da célula é a informação, a cor
// só orienta o olho. Célula sem movimento fica vazia, não "0".
const ROTULO_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function estilo(valor: number, maximo: number) {
  if (valor <= 0 || maximo <= 0) return undefined;
  const t = Math.min(1, valor / maximo);
  return { background: `rgba(185, 154, 88, ${(0.1 + 0.85 * t).toFixed(2)})`, color: t > 0.62 ? "#161512" : "#4a4232" };
}

export function MapaDeCalor({ mapa, diasDaSemana }: { mapa: AnaliseDemanda["mapa"]; diasDaSemana: AnaliseDemanda["diasDaSemana"] }) {
  if (mapa.horas.length === 0) return <p className="analise-nota">Nenhuma venda com horário neste período.</p>;
  const celula = (dow: number, hora: string) => mapa.celulas.find((c) => c.dow === dow && c.hora === hora);
  const maximo = Math.max(0, ...mapa.celulas.map((c) => c.pessoasPorDia));

  return (
    <div className="mapa-rolagem" tabIndex={0} role="region" aria-label="Mapa de calor de pessoas por dia da semana e hora">
      <table className="mapa-calor">
        <caption className="sr-only">Pessoas por dia, por dia da semana e hora</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            {mapa.horas.map((h) => (
              <th key={h} scope="col">
                {h}h
              </th>
            ))}
            <th scope="col" className="mapa-total">
              Dia todo
            </th>
          </tr>
        </thead>
        <tbody>
          {ORDEM_SEMANA.map((dow) => {
            const dia = diasDaSemana[dow];
            return (
              <tr key={dow}>
                <th scope="row">
                  {ROTULO_DIA[dow]}
                  <span className="mapa-dias">{dia.diasObservados} dias</span>
                </th>
                {mapa.horas.map((h) => {
                  const c = celula(dow, h);
                  const v = c?.pessoasPorDia ?? 0;
                  return (
                    <td key={h} style={estilo(v, maximo)} title={c ? `${ROTULO_DIA[dow]}, ${h}h: ${decimal1(v)} pessoas por dia (${c.vendas} comandas)` : undefined}>
                      {v >= 0.5 ? Math.round(v) : v > 0 ? "<1" : ""}
                    </td>
                  );
                })}
                <td className="mapa-total">{dia.diasObservados > 0 ? decimal1(dia.pessoasPorDia) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mapa-legenda" aria-hidden>
        <span className="mapa-escala" /> menos pessoas <span className="mapa-escala-seta">→</span> mais pessoas
      </p>
    </div>
  );
}
