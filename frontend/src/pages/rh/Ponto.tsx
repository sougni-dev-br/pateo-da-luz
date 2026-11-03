// RH → Ponto: apuração das horas pela CLT para o fechamento da folha. Junta o ponto eletrônico
// (AFD do RHiD) e o de papel numa conta só: faltas, atrasos (banco de horas), extras e adicional noturno.
import { CalendarX2, ChevronLeft, ChevronRight, Lock, LockOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, type PessoaPonto, faltasParaEscalaPonto, fecharPontoMes, getPontoMes, reabrirPontoMes } from "../../api/client";
import { Alert, Button, EmptyState, StatusBadge, Tabs } from "../../design-system";
import { DigitarPapel } from "./ponto/DigitarPapel";
import { ImportarRelogio } from "./ponto/ImportarRelogio";
import { ResumoMes } from "./ponto/ResumoMes";
import { MESES } from "./ponto/pontoFormato";
import "./ponto/ponto.css";

type Aba = "fechamento" | "papel" | "relogio";
const ABAS: Array<{ value: Aba; label: string }> = [
  { value: "fechamento", label: "Fechamento" },
  { value: "papel", label: "Ponto de papel" },
  { value: "relogio", label: "Importar relógio" },
];

type Mes = { year: number; month: number };
const chaveDe = ({ year, month }: Mes) => `${year}-${String(month).padStart(2, "0")}`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// A folha fecha o mês anterior: até o dia 10 a tela já abre nele.
function mesPadrao(hoje = new Date()): Mes {
  const base = hoje.getDate() <= 10 ? new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1) : hoje;
  return { year: base.getFullYear(), month: base.getMonth() + 1 };
}

function lerMes(valor: string | null): Mes {
  const m = /^(\d{4})-(\d{2})$/.exec(valor ?? "");
  const month = m ? Number(m[2]) : 0;
  return m && month >= 1 && month <= 12 ? { year: Number(m[1]), month } : mesPadrao();
}

const somarMes = ({ year, month }: Mes, delta: number): Mes => {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

const porExtenso = ({ year, month }: Mes) => `${MESES[month - 1]} de ${year}`;
const capitalizar = (texto: string) => `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`;

type Carregado = { chave: string; pessoas: PessoaPonto[] };

export function Ponto() {
  const [params, setParams] = useSearchParams();
  const mes = lerMes(params.get("mes"));
  const { year, month } = mes;
  const chave = chaveDe(mes);
  const aba = ABAS.find((a) => a.value === params.get("aba"))?.value ?? "fechamento";
  const [carregado, setCarregado] = useState<Carregado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pessoaPapel, setPessoaPapel] = useState("");

  const carregar = useCallback(async (sinal?: AbortSignal) => {
    setErro(null);
    try {
      const r = await getPontoMes(year, month, sinal);
      setCarregado({ chave: `${r.year}-${String(r.month).padStart(2, "0")}`, pessoas: r.pessoas });
    } catch (e) {
      if (sinal?.aborted) return;
      setErro(e instanceof Error ? e.message : "Não consegui carregar o ponto.");
    }
  }, [year, month]);

  useEffect(() => {
    const controle = new AbortController();
    void carregar(controle.signal);
    return () => controle.abort();
  }, [carregar]);

  // Só vale como "este mês" o que veio do servidor para ele; trocar de mês não apaga a lista antiga (o seletor de pessoa).
  const pessoas = carregado?.chave === chave ? carregado.pessoas : null;
  const todasAsPessoas = carregado?.pessoas ?? [];

  const irPara = (novo: { mes?: Mes; aba?: Aba }) => {
    const alvo = novo.mes ?? mes;
    const proximo: Record<string, string> = { mes: chaveDe(alvo) };
    const abaNova = novo.aba ?? aba;
    if (abaNova !== "fechamento") proximo.aba = abaNova;
    setAviso("");
    setParams(proximo, { replace: true });
  };

  // `acao` devolve a frase de sucesso, ou null quando a pessoa desistiu na confirmação.
  const executar = async (acao: () => Promise<string | null>) => {
    if (ocupado) return;
    setOcupado(true);
    setErro(null);
    setAviso("");
    try {
      const frase = await acao();
      if (frase) setAviso(frase);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui concluir.");
    } finally {
      setOcupado(false);
    }
  };

  const lista = pessoas ?? [];
  const abertas = lista.filter((p) => !p.semJornada && p.status === "ABERTO");
  const fechadas = lista.filter((p) => p.status === "FECHADO");
  const semJornada = lista.filter((p) => p.semJornada);
  const comConferir = abertas.filter((p) => p.resumo.diasComAviso > 0);
  const estado = fechadas.length === 0 ? "aberto" : abertas.length === 0 ? "fechado" : "parcial";
  const nomeMes = porExtenso(mes);

  const fechar = () => {
    const linhas = [
      `Fechar ${nomeMes} para ${plural(abertas.length, "pessoa", "pessoas")}?`,
      comConferir.length > 0 ? `${plural(comConferir.length, "pessoa ainda tem", "pessoas ainda têm")} dias para conferir.` : "",
      semJornada.length > 0 ? `${plural(semJornada.length, "pessoa sem jornada cadastrada NÃO entra", "pessoas sem jornada cadastrada NÃO entram")} na conta.` : "",
      "Os lançamentos do mês ficam travados e o saldo do banco passa para o mês seguinte. Dá para reabrir depois.",
    ].filter(Boolean);
    if (!window.confirm(linhas.join("\n\n"))) return;
    void executar(async () => {
      const sucesso = (n: number) => `${capitalizar(nomeMes)} fechado para ${plural(n, "pessoa", "pessoas")}.`;
      try {
        return sucesso((await fecharPontoMes(year, month)).fechados);
      } catch (e) {
        if (!(e instanceof ApiError) || e.body?.codigo !== "CONFIRMAR_AVISOS") throw e;
        if (!window.confirm(`${e.message}\n\nFechar mesmo assim?`)) return null;
        return sucesso((await fecharPontoMes(year, month, true)).fechados);
      }
    });
  };

  // O Ponto apura a falta; a gorjeta, o VT e a folha leem a falta da Escala. Simula, mostra quem seria afetado e só grava confirmado.
  const lancarFaltasNaEscala = () => {
    void executar(async () => {
      const previa = await faltasParaEscalaPonto(year, month, true);
      if (previa.faltas === 0) return "Não há faltas novas para lançar na Escala.";
      const quem = previa.pessoas.slice(0, 6).map((p) => `${p.nome} (${p.dias.length})`).join(", ");
      const aviso = `Lançar ${plural(previa.faltas, "falta", "faltas")} na Escala de ${nomeMes}?

${quem}${previa.pessoas.length > 6 ? "…" : ""}

A falta na Escala também é lida pela gorjeta, pelo vale-transporte e pela folha.`;
      if (!window.confirm(aviso)) return null;
      const r = await faltasParaEscalaPonto(year, month, false);
      return `${plural(r.faltas, "falta lançada", "faltas lançadas")} na Escala de ${nomeMes}.`;
    });
  };

  const reabrir = () => {
    if (!window.confirm(`Reabrir ${nomeMes}?\n\nOs lançamentos voltam a poder ser corrigidos. Ao fechar de novo, o resultado é refeito.`)) return;
    // O fechamento que está sendo desfeito vai para a auditoria junto com o motivo.
    const motivo = window.prompt("Por que reabrir o ponto deste mês? (fica registrado na auditoria)");
    if (motivo === null) return;
    void executar(async () => `${capitalizar(nomeMes)} reaberto para ${plural((await reabrirPontoMes(year, month, motivo)).reabertos, "pessoa", "pessoas")}.`);
  };

  return (
    <section className="po-tela">
      <div className="po-topo">
        <div className="po-mes" role="group" aria-label="Mês">
          <Button variant="icon" iconOnly aria-label="Mês anterior" onClick={() => irPara({ mes: somarMes(mes, -1) })}><ChevronLeft size={18} /></Button>
          <strong className="po-mes-nome" aria-live="polite">{capitalizar(nomeMes)}</strong>
          <Button variant="icon" iconOnly aria-label="Próximo mês" onClick={() => irPara({ mes: somarMes(mes, 1) })}><ChevronRight size={18} /></Button>
        </div>
        {pessoas && lista.length > 0 ? (
          <StatusBadge tone={estado === "fechado" ? "success" : estado === "parcial" ? "warning" : "neutral"}>
            {estado === "fechado" ? "Mês fechado" : estado === "parcial" ? `Parcial: ${fechadas.length} fechadas, ${abertas.length} abertas` : "Mês em aberto"}
          </StatusBadge>
        ) : null}
        <Tabs className="po-abas" tabs={ABAS} value={aba} onChange={(v) => irPara({ aba: v as Aba })} aria-label="Seções do ponto" />
      </div>

      <div role="status">{aviso ? <Alert tone="success">{aviso}</Alert> : null}</div>
      {erro ? (
        <Alert tone="error" role="alert">
          {erro} <Button variant="secondary" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
        </Alert>
      ) : null}

      {aba === "fechamento" ? (
        <div role="tabpanel" aria-label="Fechamento" className="po-painel">
          {pessoas === null && !erro ? <p className="po-ajuda" role="status">Carregando…</p> : null}
          {pessoas !== null && pessoas.length === 0 ? (
            <EmptyState
              title="Ninguém no ponto deste mês"
              description="Importe o arquivo do relógio ou lance o ponto de papel. Para uma pessoa aparecer, ela precisa ter jornada cadastrada (entrada, saída e intervalo) ou alguma batida no mês."
            />
          ) : null}
          {pessoas !== null && pessoas.length > 0 ? (
            <>
              <div className="po-acoes">
                {estado !== "fechado" ? (
                  <Button leadingIcon={<Lock size={16} />} aria-disabled={ocupado || abertas.length === 0 || undefined} aria-busy={ocupado} onClick={() => { if (abertas.length > 0) fechar(); }}>
                    Fechar {nomeMes}
                  </Button>
                ) : null}
                {estado !== "fechado" ? (
                  <Button variant="secondary" leadingIcon={<CalendarX2 size={16} />} aria-disabled={ocupado || undefined} aria-busy={ocupado} onClick={lancarFaltasNaEscala} title="Dia trabalhado sem batida vira falta na Escala, que a gorjeta, o VT e a folha leem">
                    Lançar faltas na escala
                  </Button>
                ) : null}
                {estado !== "aberto" ? (
                  <Button variant="secondary" leadingIcon={<LockOpen size={16} />} aria-disabled={ocupado || undefined} aria-busy={ocupado} onClick={reabrir}>
                    Reabrir {nomeMes}
                  </Button>
                ) : null}
                <span className="po-ajuda">Fechar guarda o resultado e trava os lançamentos do mês; o saldo do banco passa para o mês seguinte.</span>
              </div>
              <Alert tone="info" title="O que o Ponto ainda não paga sozinho">
                Extra e adicional noturno daqui <strong>não entram</strong> sozinhos na Folha nem na Gorjeta. Se você já digita hora extra, adicional noturno ou faltas em “Dados para o RH” da Gorjeta, não repita o que está aqui. Já as faltas lançadas na Escala (botão acima) descontam o VT e entram na gorjeta.
              </Alert>
              <ResumoMes pessoas={pessoas} onAbrirPapel={(id) => { setPessoaPapel(id); irPara({ aba: "papel" }); }} />
            </>
          ) : null}
        </div>
      ) : null}

      {aba === "papel" ? (
        <div role="tabpanel" aria-label="Ponto de papel" className="po-painel">
          <DigitarPapel
            year={year}
            month={month}
            pessoas={todasAsPessoas.map((p) => ({ employeeId: p.employeeId, nome: p.nome }))}
            employeeId={pessoaPapel}
            onEscolher={setPessoaPapel}
            fechado={pessoas === null || pessoas.find((p) => p.employeeId === pessoaPapel)?.status === "FECHADO"}
            resumo={pessoas?.find((p) => p.employeeId === pessoaPapel)?.resumo ?? null}
            onSalvou={() => void carregar()}
            onIrParaFechamento={() => irPara({ aba: "fechamento" })}
          />
        </div>
      ) : null}

      {aba === "relogio" ? (
        <div role="tabpanel" aria-label="Importar relógio" className="po-painel">
          <ImportarRelogio onImportou={() => void carregar()} onVerMes={(y, m) => irPara({ mes: { year: y, month: m }, aba: "fechamento" })} />
        </div>
      ) : null}
    </section>
  );
}
