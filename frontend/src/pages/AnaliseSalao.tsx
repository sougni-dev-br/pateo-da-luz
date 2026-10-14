import { useEffect, useRef, useState } from "react";
import {
  getAnaliseCardapio,
  getAnaliseDemanda,
  getAnaliseMargem,
  getAnalisePerdas,
  getAnaliseResumo,
  getAnaliseVendasPorPessoa,
  vincularProdutoAnaliseMargem,
  type AnalisePeriodo
} from "../api/client";
import { useSession } from "../context/SessionContext";
import { Alert, Button, PageHeader, Select, Tabs, TextField } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { AvisoHoje } from "./analise-salao/AvisoHoje";
import { CardapioPanel } from "./analise-salao/CardapioPanel";
import { DemandaPanel } from "./analise-salao/DemandaPanel";
import { MargemPanel } from "./analise-salao/MargemPanel";
import { MetasPanel } from "./analise-salao/MetasPanel";
import type { SecaoDaAnalise } from "./analise-salao/InsightCard";
import { PerdasPanel } from "./analise-salao/PerdasPanel";
import { ResumoPanel } from "./analise-salao/ResumoPanel";
import { VendasPorPessoaPanel } from "./analise-salao/VendasPorPessoaPanel";
import { PRESETS, periodoDoPreset, periodoValido, type PresetPeriodo } from "./analise-salao/periodo";
import "./AnaliseSalao.css";

type Aba = SecaoDaAnalise | "equipe" | "metas";
type Preset = PresetPeriodo | "personalizado";

const ABAS = [
  { value: "resumo", label: "Resumo" },
  { value: "demanda", label: "Quando vendemos" },
  { value: "cardapio", label: "Cardápio" },
  { value: "margem", label: "Margem" },
  { value: "perdas", label: "Perdas" },
  { value: "equipe", label: "Equipe" },
  { value: "metas", label: "Metas" }
];
const OPCOES_PERIODO = [...PRESETS, { value: "personalizado", label: "Personalizado" }];
const AVISO_PERIODO = "Confira as datas: o início deve ser anterior ao fim, em até 366 dias.";
const MENSAGEM_ERRO = "Não foi possível carregar o relatório.";
const SEM_RELATORIO = { dados: null, carregando: false, erro: null, recarregar: () => undefined };

// Estado de UMA consulta, sempre amarrado à chave do período: dado, erro ou "carregando" de um
// período nunca é lido sob outro, e voltar a um período cuja consulta foi abortada refaz a busca.
type Estado<T> = { chave: string; tentativa: number } & ({ tipo: "carregando" } | { tipo: "ok"; dados: T } | { tipo: "erro"; mensagem: string });

// Busca o relatório da aba ATIVA para o período pedido e guarda o resultado do último período
// carregado: trocar de aba e voltar, no mesmo período, não refaz a consulta.
function useRelatorio<T>(buscar: (periodo: AnalisePeriodo, signal: AbortSignal) => Promise<T>, periodo: AnalisePeriodo, ativo: boolean) {
  const chave = `${periodo.inicio}|${periodo.fim}`;
  const valido = periodoValido(periodo);
  const [estado, setEstado] = useState<Estado<T> | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  useEffect(() => {
    if (!ativo || !valido) return;
    const atual = estadoRef.current;
    // Só a busca que terminou bem para ESTE período dispensa nova consulta.
    if (atual?.chave === chave && atual.tipo === "ok" && atual.tentativa === tentativa) return;
    const controller = new AbortController();
    setEstado({ chave, tentativa, tipo: "carregando" });
    buscar(periodo, controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setEstado({ chave, tentativa, tipo: "ok", dados });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setEstado({ chave, tentativa, tipo: "erro", mensagem: e instanceof Error ? e.message : MENSAGEM_ERRO });
      });
    return () => controller.abort();
    // `buscar` e `periodo` são estáveis para uma mesma chave; a chave resume o período.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, chave, valido, tentativa]);

  const doPeriodo = estado?.chave === chave ? estado : null;
  return {
    dados: doPeriodo?.tipo === "ok" ? doPeriodo.dados : null,
    // Sem estado para este período ainda é "carregando": o efeito acaba de começar a busca.
    carregando: ativo && valido && (doPeriodo === null || doPeriodo.tipo === "carregando"),
    erro: ativo && doPeriodo?.tipo === "erro" ? doPeriodo.mensagem : null,
    recarregar: () => setTentativa((n) => n + 1)
  };
}

export function AnaliseSalao() {
  const [aba, setAba] = useState<Aba>("resumo");
  const [preset, setPreset] = useState<Preset>("ultimos30");
  const [periodo, setPeriodo] = useState<AnalisePeriodo>(() => periodoDoPreset("ultimos30", new Date()));
  const valido = periodoValido(periodo);
  const conteudo = useRef<HTMLDivElement>(null);
  const { user } = useSession();
  const podeEditar = hasPermission(user, "analise-salao", "edit");

  const resumo = useRelatorio(getAnaliseResumo, periodo, aba === "resumo");
  const demanda = useRelatorio(getAnaliseDemanda, periodo, aba === "demanda");
  const cardapio = useRelatorio(getAnaliseCardapio, periodo, aba === "cardapio");
  const margem = useRelatorio(getAnaliseMargem, periodo, aba === "margem");
  // Depois de vincular o relatório é relido: o painel antigo continua na tela (sem pulo nem perda de foco) até o novo chegar.
  const ultimaMargem = useRef<typeof margem.dados>(null);
  const [vinculo, setVinculo] = useState<{ texto: string; chave: string } | null>(null);
  const chavePeriodo = `${periodo.inicio}|${periodo.fim}`;
  const avisoDoVinculo = vinculo && vinculo.chave === chavePeriodo ? vinculo.texto : null;
  if (margem.dados) ultimaMargem.current = margem.dados;
  const margemNaTela = margem.dados ?? (margem.carregando && avisoDoVinculo !== null ? ultimaMargem.current : null);
  const perdas = useRelatorio(getAnalisePerdas, periodo, aba === "perdas");
  const equipe = useRelatorio(getAnaliseVendasPorPessoa, periodo, aba === "equipe");
  // Metas é por mês e se carrega sozinha: não usa o período do topo.
  const atual = aba === "metas" ? SEM_RELATORIO : { resumo, demanda, cardapio, margem, perdas, equipe }[aba];

  // Vincula (ou desfaz) e relê o relatório: a margem do prato entra na tabela no mesmo instante.
  async function vincular(codigo: string, nome: string, pratoId: string | null) {
    await vincularProdutoAnaliseMargem({ codigo, nome, pratoId });
    setVinculo({ texto: pratoId === null ? `Vínculo de ${nome} desfeito.` : `${nome} vinculado.`, chave: chavePeriodo });
    margem.recarregar();
  }

  function escolherPreset(valor: string) {
    if (valor === "personalizado") {
      setPreset("personalizado");
      return;
    }
    setPreset(valor as PresetPeriodo);
    setPeriodo(periodoDoPreset(valor as PresetPeriodo, new Date()));
  }

  function editarData(campo: keyof AnalisePeriodo, valor: string) {
    setPreset("personalizado");
    setPeriodo((anterior) => ({ ...anterior, [campo]: valor }));
  }

  // Ao abrir outra seção por um link (o botão que foi clicado some), leva a rolagem e o foco para o
  // conteúdo revelado em vez de deixar o foco no <body>.
  function abrirSecao(secao: Aba) {
    setAba(secao);
    requestAnimationFrame(() => {
      conteudo.current?.focus({ preventScroll: true });
      conteudo.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    });
  }

  const pronto = aba !== "metas" && valido && !atual.carregando && !atual.erro;

  return (
    <div className="analise-salao">
      <PageHeader
        eyebrow="Financeiro"
        title="Análise do Salão"
        description="Para decidir: como o salão está indo, quando vende e onde perde dinheiro, a partir das vendas do PDV."
      />

      {aba !== "metas" && (
      <div className="analise-filtros">
        <Select label="Período" value={preset} options={OPCOES_PERIODO} onChange={(e) => escolherPreset(e.target.value)} />
        <TextField label="De" type="date" value={periodo.inicio} max={periodo.fim || undefined} onChange={(e) => editarData("inicio", e.target.value)} />
        <TextField label="Até" type="date" value={periodo.fim} min={periodo.inicio || undefined} onChange={(e) => editarData("fim", e.target.value)} />
      </div>
      )}

      <Tabs tabs={ABAS} value={aba} onChange={(v) => setAba(v as Aba)} aria-label="Seções da análise do salão" />

      <div className="analise-conteudo" aria-busy={atual.carregando} ref={conteudo} tabIndex={-1}>
        {/* Só o status é anunciado: ler as tabelas inteiras a cada carga seria ruído. */}
        <div aria-live="polite">
          {aba !== "metas" && !valido && <Alert tone="warning">{AVISO_PERIODO}</Alert>}
          {valido && atual.erro && (
            <Alert tone="error">
              {atual.erro}{" "}
              <Button variant="secondary" size="sm" onClick={atual.recarregar}>
                Tentar de novo
              </Button>
            </Alert>
          )}
          {valido && atual.carregando && <p className="analise-nota">Carregando…</p>}
        </div>
        {aba === "metas" && <MetasPanel />}
        {pronto && aba === "resumo" && resumo.dados && <ResumoPanel dados={resumo.dados} onAbrir={abrirSecao} />}
        {pronto && aba === "demanda" && demanda.dados && <DemandaPanel dados={demanda.dados} />}
        {pronto && aba === "cardapio" && cardapio.dados && <CardapioPanel dados={cardapio.dados} />}
        {aba === "margem" && avisoDoVinculo && (
          <p className="analise-nota" role="status">
            {avisoDoVinculo}
            {margem.carregando ? " Recalculando a margem…" : " Margem recalculada."}
          </p>
        )}
        {aba === "margem" && margemNaTela && (pronto || avisoDoVinculo !== null) && <MargemPanel dados={margemNaTela} podeEditar={podeEditar} onVincular={vincular} />}
        {pronto && aba === "perdas" && perdas.dados && <PerdasPanel dados={perdas.dados} />}
        {pronto && aba === "equipe" && equipe.dados && (
          <div className="analise-stack">
            <AvisoHoje ativo={equipe.dados.hojeFicouDeFora} />
            <VendasPorPessoaPanel dados={equipe.dados} />
          </div>
        )}
      </div>
    </div>
  );
}
