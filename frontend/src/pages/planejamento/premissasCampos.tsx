import { useEffect, useId, useState } from "react";
import type { PlanejamentoProjecao } from "../../api/client";
import { MOTIVO_SEM_BASE, percentualParaTexto, textoDaVariacao, textoParaPercentual } from "./formato";
import { emMil } from "./Reais";
import { useOculto } from "./useOculto";

// Peças das premissas usadas pela tabela (computador) e pelos cartões (celular/tablet): as colunas, o campo de
// percentual que só avisa o pai com número válido, e o efeito do mês nas vendas.

export type Coluna = "clientesAlmoco" | "clientesJantar" | "ticketAlmoco" | "ticketJantar" | "cmv";

export const COLUNAS: { chave: Coluna; rotulo: string; ajuda: string }[] = [
  { chave: "clientesAlmoco", rotulo: "Clientes almoço", ajuda: "Crescimento de clientes no almoço sobre o ano-base, em %" },
  { chave: "clientesJantar", rotulo: "Clientes jantar", ajuda: "Crescimento de clientes no jantar sobre o ano-base, em %" },
  { chave: "ticketAlmoco", rotulo: "Ticket almoço", ajuda: "Crescimento do ticket médio do almoço sobre o ano-base, em %" },
  { chave: "ticketJantar", rotulo: "Ticket jantar", ajuda: "Crescimento do ticket médio do jantar sobre o ano-base, em %" },
  { chave: "cmv", rotulo: "CMV", ajuda: "CMV do mês, em % das vendas (vazio = ainda não definido)" }
];

const LIMITE_MINIMO = -90;
const LIMITE_MAXIMO = 500;

/** Texto → fração aceita (ou null para vazio no CMV); undefined se o texto não serve. */
function lerPercentual(texto: string, aceitaVazio: boolean): number | null | undefined {
  if (texto.trim() === "") return aceitaVazio ? null : undefined;
  const fracao = textoParaPercentual(texto);
  if (fracao === null) return undefined;
  const pct = fracao * 100;
  const dentro = pct >= LIMITE_MINIMO && pct <= LIMITE_MAXIMO && (aceitaVazio ? pct >= 0 && pct <= 100 : true);
  return dentro ? fracao : undefined;
}

function mensagemDoInvalido(texto: string, aceitaVazio: boolean): string {
  if (texto.trim() === "") return "Digite um número.";
  if (textoParaPercentual(texto) === null) return "Digite um número (ex.: 5 ou 5,5).";
  return aceitaVazio ? "Use de 0 a 100." : `Use de ${LIMITE_MINIMO} a ${LIMITE_MAXIMO}.`;
}

type CampoProps = {
  valor: number | null;
  rotulo: string;
  desabilitado: boolean;
  aceitaVazio: boolean;
  /** Linha "Todos": guarda o valor até Enter/saída e avisa a prévia enquanto digita. */
  adiado?: boolean;
  vaiMudar?: boolean;
  onPrevia?: (valor: number | null | undefined) => void;
  onMudar: (v: number | null) => void;
};

/**
 * Campo de percentual: guarda o texto enquanto a pessoa digita e só avisa o pai quando o texto vira um número
 * válido dentro da faixa; reescreve o texto quando o valor muda de fora (ex.: "Todos").
 */
export function CampoPercentual({ valor, rotulo, desabilitado, aceitaVazio, adiado = false, vaiMudar = false, onPrevia, onMudar }: CampoProps) {
  const [texto, setTexto] = useState(valor === null ? "" : percentualParaTexto(valor));
  const [invalido, setInvalido] = useState(false);
  const idDoErro = useId();

  useEffect(() => {
    const atual = texto.trim() === "" ? null : textoParaPercentual(texto);
    if (atual !== valor) {
      setTexto(valor === null ? "" : percentualParaTexto(valor));
      setInvalido(false);
    }
    // Só reage ao valor vindo de fora; o texto em edição não deve disparar a regravação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor]);

  function voltar() {
    setTexto(valor === null ? "" : percentualParaTexto(valor));
    setInvalido(false);
    onPrevia?.(undefined);
  }

  function aplicarAdiado() {
    const lido = lerPercentual(texto, aceitaVazio);
    onPrevia?.(undefined);
    if (lido === undefined) { voltar(); return; }
    const vazioSemValor = texto.trim() === "" && valor === null;
    if (!vazioSemValor) onMudar(lido);
  }

  // Texto inválido não chega ao pai: ao sair do campo ele volta ao último valor aceito, para a tela não mostrar
  // um número diferente do que será salvo.
  function aoSair() {
    if (adiado) { aplicarAdiado(); return; }
    if (invalido) voltar();
  }

  function digitar(novo: string) {
    setTexto(novo);
    const lido = lerPercentual(novo, aceitaVazio);
    setInvalido(lido === undefined);
    if (adiado) { onPrevia?.(lido); return; }
    if (lido !== undefined) onMudar(lido);
  }

  return (
    <span className="plan-campo-envoltorio">
      <input
        className={`plan-campo${invalido ? " plan-campo-invalido" : ""}${vaiMudar ? " plan-campo-vai-mudar" : ""}`}
        inputMode="decimal"
        aria-label={rotulo}
        aria-invalid={invalido || undefined}
        aria-describedby={invalido ? idDoErro : undefined}
        value={texto}
        disabled={desabilitado}
        onChange={(e) => digitar(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={aoSair}
        onKeyDown={(e) => {
          if (!adiado) return;
          if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); aplicarAdiado(); }
          else if (e.key === "Escape") { e.preventDefault(); voltar(); }
        }}
      />
      {invalido && <span id={idDoErro} className="plan-campo-erro" role="status">{mensagemDoInvalido(texto, aceitaVazio)}</span>}
    </span>
  );
}

export function Efeito({ projecao, mes }: { projecao: PlanejamentoProjecao | null | undefined; mes: number }) {
  const hidden = useOculto();
  const m = projecao?.meses[mes - 1];
  if (!projecao || !m) return <span className="plan-efeito-vazio">—</span>;
  if (!m.projetado || !m.base) return <span className="plan-efeito-vazio">{MOTIVO_SEM_BASE[m.motivoSemBase ?? "SEM_DADO"] ?? "sem base"}</span>;
  const variacao = m.base.vendas.total > 0 ? m.projetado.vendas.total / m.base.vendas.total - 1 : null;
  const tom = variacao === null || Math.round(variacao * 1000) === 0 ? "" : variacao > 0 ? " plan-var-sobe" : " plan-var-desce";
  return (
    <span className="plan-efeito">
      <span className="plan-efeito-valor">{hidden ? "••••" : emMil(m.projetado.vendas.total)}</span>
      <span className={`plan-efeito-variacao${tom}`}>{textoDaVariacao(variacao)}</span>
    </span>
  );
}
