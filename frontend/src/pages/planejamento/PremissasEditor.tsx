import { useEffect, useState } from "react";
import type { PlanejamentoPremissasDoMes } from "../../api/client";
import { Table } from "../../design-system";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, textoParaPercentual } from "./formato";

// Premissas do cenário, uma linha por mês: crescimento de clientes e de ticket médio por turno (sobre o ano-base)
// e o % de CMV do mês. A primeira linha ("Todos") preenche a coluna inteira de uma vez.

type Coluna = "clientesAlmoco" | "clientesJantar" | "ticketAlmoco" | "ticketJantar" | "cmv";

const COLUNAS: { chave: Coluna; rotulo: string; ajuda: string }[] = [
  { chave: "clientesAlmoco", rotulo: "Clientes almoço", ajuda: "Crescimento de clientes no almoço sobre o ano-base, em %" },
  { chave: "clientesJantar", rotulo: "Clientes jantar", ajuda: "Crescimento de clientes no jantar sobre o ano-base, em %" },
  { chave: "ticketAlmoco", rotulo: "Ticket almoço", ajuda: "Crescimento do ticket médio do almoço sobre o ano-base, em %" },
  { chave: "ticketJantar", rotulo: "Ticket jantar", ajuda: "Crescimento do ticket médio do jantar sobre o ano-base, em %" },
  { chave: "cmv", rotulo: "CMV", ajuda: "CMV do mês, em % das vendas (vazio = ainda não definido)" }
];

const LIMITE_MINIMO = -90;
const LIMITE_MAXIMO = 500;

type CampoProps = { valor: number | null; rotulo: string; desabilitado: boolean; aceitaVazio: boolean; onMudar: (v: number | null) => void };

/**
 * Campo de percentual: guarda o texto enquanto a pessoa digita e só avisa o pai quando o texto vira um número
 * válido dentro da faixa; reescreve o texto quando o valor muda de fora (ex.: "Todos").
 */
function CampoPercentual({ valor, rotulo, desabilitado, aceitaVazio, onMudar }: CampoProps) {
  const [texto, setTexto] = useState(valor === null ? "" : percentualParaTexto(valor));
  const [invalido, setInvalido] = useState(false);

  useEffect(() => {
    const atual = texto.trim() === "" ? null : textoParaPercentual(texto);
    if (atual !== valor) {
      setTexto(valor === null ? "" : percentualParaTexto(valor));
      setInvalido(false);
    }
    // Só reage ao valor vindo de fora; o texto em edição não deve disparar a regravação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  // Texto inválido não chega ao pai: ao sair do campo ele volta ao último valor aceito, para a tela não mostrar
  // um número diferente do que será salvo.
  function aoSair() {
    if (!invalido) return;
    setTexto(valor === null ? "" : percentualParaTexto(valor));
    setInvalido(false);
  }

  function digitar(novo: string) {
    setTexto(novo);
    if (novo.trim() === "") {
      setInvalido(!aceitaVazio);
      if (aceitaVazio) onMudar(null);
      return;
    }
    const fracao = textoParaPercentual(novo);
    const pct = fracao === null ? null : fracao * 100;
    const valido = pct !== null && pct >= LIMITE_MINIMO && pct <= LIMITE_MAXIMO && (aceitaVazio ? pct >= 0 && pct <= 100 : true);
    setInvalido(!valido);
    if (valido && fracao !== null) onMudar(fracao);
  }

  return (
    <input
      className={`plan-campo${invalido ? " plan-campo-invalido" : ""}`}
      inputMode="decimal"
      aria-label={rotulo}
      aria-invalid={invalido || undefined}
      value={texto}
      disabled={desabilitado}
      onChange={(e) => digitar(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={aoSair}
    />
  );
}

type Props = {
  premissas: PlanejamentoPremissasDoMes[];
  desabilitado: boolean;
  onMudar: (proximas: PlanejamentoPremissasDoMes[]) => void;
};

export function PremissasEditor({ premissas, desabilitado, onMudar }: Props) {
  function mudarMes(mes: number, coluna: Coluna, valor: number | null) {
    onMudar(premissas.map((p) => (p.mes === mes ? { ...p, [coluna]: valor } : p)));
  }
  function mudarTodos(coluna: Coluna, valor: number | null) {
    onMudar(premissas.map((p) => ({ ...p, [coluna]: valor })));
  }

  // O valor do "Todos" só aparece quando os 12 meses estão iguais; senão fica vazio para não mentir.
  const valorComum = (coluna: Coluna): number | null => {
    const primeiro = premissas[0]?.[coluna] ?? null;
    return premissas.every((p) => p[coluna] === primeiro) ? primeiro : null;
  };

  return (
    <Table aria-label="Premissas do cenário por mês">
      <Table.Head>
        <Table.Row>
          <Table.Th scope="col">Mês</Table.Th>
          {COLUNAS.map((c) => <Table.Th key={c.chave} align="right" title={c.ajuda}>{c.rotulo} %</Table.Th>)}
        </Table.Row>
      </Table.Head>
      <Table.Body>
        <Table.Row className="plan-linha-todos">
          <Table.Th scope="row">Todos os meses</Table.Th>
          {COLUNAS.map((c) => (
            <Table.Td key={c.chave} align="right">
              <CampoPercentual valor={valorComum(c.chave)} rotulo={`${c.rotulo}, todos os meses`} desabilitado={desabilitado} aceitaVazio={c.chave === "cmv"} onMudar={(v) => mudarTodos(c.chave, v)} />
            </Table.Td>
          ))}
        </Table.Row>
        {premissas.map((p) => (
          <Table.Row key={p.mes}>
            <Table.Th scope="row">{NOMES_DOS_MESES_CURTOS[p.mes - 1]}</Table.Th>
            {COLUNAS.map((c) => (
              <Table.Td key={c.chave} align="right">
                <CampoPercentual valor={p[c.chave]} rotulo={`${c.rotulo} em ${NOMES_DOS_MESES_CURTOS[p.mes - 1]}`} desabilitado={desabilitado} aceitaVazio={c.chave === "cmv"} onMudar={(v) => mudarMes(p.mes, c.chave, v)} />
              </Table.Td>
            ))}
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  );
}
