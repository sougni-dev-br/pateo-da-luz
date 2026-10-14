import type { AnalisePerdas } from "../../api/client";
import { inteiro, percentual } from "./formato";
import { useFormato } from "./useFormato";

type Linha = { chave: string; sinal: "" | "−" | "+" | "="; rotulo: string; nota?: string; valor: number; tom: "base" | "alivio" | "perda" | "total" };

// Do valor cancelado até a perda potencial, em barras proporcionais. A leitura é de cima para
// baixo: o que foi cancelado, o que provavelmente voltou como venda, e o que sobra. A refação é
// PROVÁVEL, não certa, então o teto (sem abatê-la) aparece logo abaixo.
export function FunilDePerdas({ funil, refacao }: { funil: AnalisePerdas["funil"]; refacao: AnalisePerdas["refacao"] }) {
  const { reais } = useFormato();
  const linhas: Linha[] = [
    {
      chave: "cancelado",
      sinal: "",
      rotulo: "Cancelado em vendas",
      nota: funil.grandes > 0 ? `inclui ${reais(funil.grandes)} em ${inteiro(funil.grandesVendas)} venda${funil.grandesVendas > 1 ? "s" : ""} de valor muito alto` : undefined,
      valor: funil.cancelado,
      tom: "base"
    },
    {
      chave: "refeito",
      sinal: "−",
      rotulo: "Provável refação (comanda aberta de novo)",
      nota: `${inteiro(refacao.vendas)} cancelamentos com venda paga quase igual: mesmo dia, mesmas pessoas, valor ±${percentual(refacao.toleranciaValor, 0)} e até ${inteiro(refacao.janelaMinutos)} min de diferença. Pode haver coincidência.`,
      valor: funil.refeito,
      tom: "alivio"
    },
    { chave: "semRefacao", sinal: "=", rotulo: "Cancelamento sem refação", valor: funil.semRefacao, tom: "perda" },
    { chave: "itens", sinal: "+", rotulo: "Itens cancelados em vendas pagas", nota: "pedido tirado da conta antes de pagar", valor: funil.itensCancelados, tom: "perda" },
    { chave: "descontos", sinal: "+", rotulo: "Descontos", nota: "o que foi abatido da conta", valor: funil.descontos, tom: "perda" },
    {
      chave: "total",
      sinal: "=",
      rotulo: "Perda potencial (estimativa)",
      nota: `${percentual(funil.perdaPct)} do faturamento (${reais(funil.faturado)}). Sem abater a refação: ${reais(funil.perdaTeto)}.`,
      valor: funil.perdaTotal,
      tom: "total"
    }
  ];
  const maximo = Math.max(1, ...linhas.map((l) => l.valor));

  return (
    <ol className="funil">
      {linhas.map((l) => (
        <li key={l.chave} className={`funil-linha funil-${l.tom}`}>
          <span className="funil-sinal" aria-hidden>
            {l.sinal}
          </span>
          <div className="funil-texto">
            <span className="funil-rotulo">{l.rotulo}</span>
            {l.nota && <span className="funil-nota">{l.nota}</span>}
          </div>
          <span className="funil-trilho" aria-hidden>
            <span className="funil-barra" style={{ width: `${Math.max(l.valor > 0 ? 1.5 : 0, (l.valor / maximo) * 100)}%` }} />
          </span>
          <strong className="funil-valor">{reais(l.valor)}</strong>
        </li>
      ))}
    </ol>
  );
}
