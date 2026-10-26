import { useEffect, useState } from "react";
import { getRevenueCoverage, type CoberturaCanal, type CoberturaFaturamento, type SaudeDoAgente } from "../api/client";
import { PanelEyebrow, StatusBadge } from "../design-system";
import type { StatusTone } from "../design-system";
import "./CoberturaPorCanal.css";

const SITUACAO: Record<CoberturaCanal["situacao"], { tone: StatusTone; rotulo: string }> = {
  EM_DIA: { tone: "success", rotulo: "Em dia" },
  ATRASADO: { tone: "warning", rotulo: "Atrasado" },
  SEM_DADOS: { tone: "danger", rotulo: "Sem dados" }
};

/** O que fazer quando o canal atrasa — cada um entra por um caminho diferente. */
const DICA_DE_ATRASO: Record<CoberturaCanal["canal"], string> = {
  Salão: "O Agile PDV deixou de sincronizar. Confira o agente na PDVTOUCH.",
  "99Food": "A 99 libera a fatura do dia na API com 1–2 dias de atraso. Se passar disso, rode Sincronizar em Integrações Delivery e confira o log da rodada das 04h.",
  iFood: "O iFood ainda não tem integração ativa; o faturamento entra por importação.",
  Keeta: "Importe o relatório diário do portal em Delivery → Keeta → Importar do portal."
};

/** YYYY-MM-DD -> DD/MM, sem passar por Date (evita virar o dia pelo fuso). */
function diaCurto(ymd: string) {
  const [, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function diaCompleto(ymd: string) {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

function textoDoAtraso(canal: CoberturaCanal) {
  if (canal.ultimoDia === null) return "nenhum lançamento";
  if (canal.diasDesdeUltimo === 1) return "ontem";
  return `há ${canal.diasDesdeUltimo} dias`;
}

/** Só há o que mostrar depois que o agente mandou o primeiro sinal de vida. */
function linhaDoAgente(agente: SaudeDoAgente | undefined): { texto: string; problema: boolean } | null {
  if (!agente || agente.estado === "aguardando") return null;
  if (agente.estado === "ok") {
    const horas = agente.horasSemOk;
    return { texto: `Agente da Keeta ativo${horas === null ? "" : horas === 0 ? ": último envio agora há pouco" : `: último envio há ${horas} h`}.`, problema: false };
  }
  return { texto: agente.alertas[0]?.mensagem ?? "O agente da Keeta precisa de atenção.", problema: true };
}

function CartaoDoCanal({ canal, agente }: { canal: CoberturaCanal; agente?: SaudeDoAgente }) {
  const situacao = SITUACAO[canal.situacao];
  const doAgente = canal.canal === "Keeta" ? linhaDoAgente(agente) : null;
  return (
    <article className="cobertura-canal">
      <header>
        <h3>{canal.canal}</h3>
        <StatusBadge tone={situacao.tone}>{situacao.rotulo}</StatusBadge>
      </header>
      <p className="cobertura-ultimo">
        Último dia: <strong>{canal.ultimoDia ? diaCompleto(canal.ultimoDia) : "—"}</strong>
        <span> ({textoDoAtraso(canal)})</span>
      </p>
      <p className="cobertura-dias">
        {canal.diasComDado} de {canal.diasNoPeriodo} dias com lançamento no mês
      </p>
      {(canal.lancamentosFuturos?.length ?? 0) > 0 && (
        <p className="cobertura-dica">
          Lançamento com data futura ({canal.lancamentosFuturos!.map(diaCurto).join(" · ")}) não conta como cobertura.
        </p>
      )}
      {doAgente && <p className={doAgente.problema ? "cobertura-dica" : "cobertura-dias"}>{doAgente.texto}</p>}
      {canal.situacao !== "EM_DIA" && <p className="cobertura-dica">{DICA_DE_ATRASO[canal.canal]}</p>}
      {canal.diasSemLancamento.length > 0 && (
        <details>
          <summary>{canal.diasSemLancamento.length} dias sem lançamento</summary>
          <p className="cobertura-lista-dias">{canal.diasSemLancamento.map(diaCurto).join(" · ")}</p>
        </details>
      )}
      <ul className="cobertura-origens">
        {canal.origens.length === 0 && <li className="cobertura-vazio">Nenhuma origem no mês</li>}
        {canal.origens.map((origem) => (
          <li key={origem.origem}>
            {origem.origem}: {origem.dias} {origem.dias === 1 ? "dia" : "dias"}, até {diaCurto(origem.ultimoDia)}
          </li>
        ))}
      </ul>
    </article>
  );
}

export function CoberturaPorCanal({ year, month }: { year: number; month: number }) {
  const [dados, setDados] = useState<CoberturaFaturamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setErro(null);
    getRevenueCoverage({ year, month })
      .then((resposta) => ativo && setDados(resposta))
      .catch((e: unknown) => ativo && setErro(e instanceof Error ? e.message : "Falha ao carregar a cobertura"));
    return () => {
      ativo = false;
    };
  }, [year, month]);

  return (
    <section className="panel cobertura-painel" aria-label="Cobertura do faturamento por canal">
      <PanelEyebrow>Cobertura por canal</PanelEyebrow>
      {erro && <p role="alert">{erro}</p>}
      {!erro && !dados && <p className="cobertura-vazio">Carregando…</p>}
      {dados && (
        <div className="cobertura-grade">
          {dados.channels.map((canal) => (
            <CartaoDoCanal key={canal.canal} canal={canal} agente={dados.agenteKeeta} />
          ))}
        </div>
      )}
    </section>
  );
}
