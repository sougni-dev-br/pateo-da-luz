import type { AnaliseDemanda } from "../../api/client";
import { decimal1, ORDEM_SEMANA } from "./formato";
import { useFormato } from "./useFormato";

// Pessoas por dia em cada dia da semana, empilhando almoço e jantar. O ticket por pessoa vai ao
// lado: dia cheio com ticket baixo e dia vazio com ticket alto pedem decisões diferentes.
export function DiasDaSemana({ dias }: { dias: AnaliseDemanda["diasDaSemana"] }) {
  const { reais } = useFormato();
  const maximo = Math.max(1, ...dias.map((d) => d.pessoasPorDia));
  return (
    <div className="dias-rolagem" tabIndex={0} role="region" aria-label="Pessoas por dia, por dia da semana">
    <table className="dias-semana">
      <caption className="sr-only">Pessoas por dia, almoço e jantar, por dia da semana</caption>
      <thead>
        <tr>
          <th scope="col">Dia</th>
          <th scope="col">Pessoas por dia</th>
          <th scope="col" className="direita">
            Ticket por pessoa
          </th>
          <th scope="col" className="direita">
            Faturamento por dia
          </th>
        </tr>
      </thead>
      <tbody>
        {ORDEM_SEMANA.map((dow) => {
          const d = dias[dow];
          const almoco = d.turnos.find((t) => t.turno === "ALMOCO");
          const jantar = d.turnos.find((t) => t.turno === "JANTAR");
          return (
            <tr key={dow}>
              <th scope="row">{d.rotulo}</th>
              <td>
                <span className="dia-barra">
                  <span className="dia-barra-trilho" aria-hidden>
                    <span className="dia-barra-almoco" style={{ width: `${((almoco?.pessoasPorDia ?? 0) / maximo) * 100}%` }} />
                    <span className="dia-barra-jantar" style={{ width: `${((jantar?.pessoasPorDia ?? 0) / maximo) * 100}%` }} />
                  </span>
                  <span className="dia-barra-numero">
                    <strong>{d.diasObservados > 0 ? decimal1(d.pessoasPorDia) : "—"}</strong>
                    {d.diasObservados > 0 && (
                      <span className="dia-barra-turnos">
                        almoço {decimal1(almoco?.pessoasPorDia ?? 0)} · jantar {decimal1(jantar?.pessoasPorDia ?? 0)}
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <td className="direita">{d.ticketPessoa > 0 ? reais(d.ticketPessoa) : "—"}</td>
              <td className="direita">{d.diasObservados > 0 ? reais(d.faturamentoPorDia) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>
  );
}
