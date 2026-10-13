import { useEffect, useState } from "react";
import {
  getAnaliseCancelamentos,
  getAnaliseItensCancelados,
  getAnaliseVendasPorPessoa,
  type AnaliseCancelamentos,
  type AnaliseItensCancelados,
  type AnalisePeriodo,
  type AnaliseVendasPorPessoa
} from "../api/client";
import { Alert, PageHeader, Select, Tabs, TextField } from "../design-system";
import { CancelamentosPanel } from "./analise-salao/CancelamentosPanel";
import { ItensCanceladosPanel } from "./analise-salao/ItensCanceladosPanel";
import { VendasPorPessoaPanel } from "./analise-salao/VendasPorPessoaPanel";
import { PRESETS, periodoDoPreset, periodoValido, type PresetPeriodo } from "./analise-salao/periodo";
import "./AnaliseSalao.css";

type Aba = "cancelamentos" | "itens" | "vendas";
type Preset = PresetPeriodo | "personalizado";

const ABAS = [
  { value: "cancelamentos", label: "Cancelamentos" },
  { value: "itens", label: "Itens cancelados" },
  { value: "vendas", label: "Vendas por pessoa" }
];
const OPCOES_PERIODO = [...PRESETS, { value: "personalizado", label: "Personalizado" }];
const AVISO_PERIODO = "Confira as datas: o início deve ser anterior ao fim, em até 366 dias.";

export function AnaliseSalao() {
  const [aba, setAba] = useState<Aba>("cancelamentos");
  const [preset, setPreset] = useState<Preset>("ultimos30");
  const [periodo, setPeriodo] = useState<AnalisePeriodo>(() => periodoDoPreset("ultimos30", new Date()));
  const [cancelamentos, setCancelamentos] = useState<AnaliseCancelamentos | null>(null);
  const [itensCancelados, setItensCancelados] = useState<AnaliseItensCancelados | null>(null);
  const [vendas, setVendas] = useState<AnaliseVendasPorPessoa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const valido = periodoValido(periodo);

  useEffect(() => {
    if (!valido) return;
    const controller = new AbortController();
    setCarregando(true);
    setErro(null);
    // Mantém só o relatório do período pedido: dado do período anterior não pode aparecer
    // enquanto o novo carrega.
    if (aba === "cancelamentos") setCancelamentos(null);
    else if (aba === "itens") setItensCancelados(null);
    else setVendas(null);

    const pedido = aba === "cancelamentos"
      ? getAnaliseCancelamentos(periodo, controller.signal).then(setCancelamentos)
      : aba === "itens"
        ? getAnaliseItensCancelados(periodo, controller.signal).then(setItensCancelados)
        : getAnaliseVendasPorPessoa(periodo, controller.signal).then(setVendas);

    pedido
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setErro(e instanceof Error ? e.message : "Não foi possível carregar o relatório.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCarregando(false);
      });
    return () => controller.abort();
  }, [aba, periodo, valido]);

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
    setPeriodo((atual) => ({ ...atual, [campo]: valor }));
  }

  return (
    <div className="analise-salao">
      <PageHeader
        eyebrow="Financeiro"
        title="Análise do Salão"
        description="Cancelamentos e vendas por funcionário, a partir das vendas do PDV."
      />

      <div className="analise-filtros">
        <Select label="Período" value={preset} options={OPCOES_PERIODO} onChange={(e) => escolherPreset(e.target.value)} />
        <TextField label="De" type="date" value={periodo.inicio} max={periodo.fim || undefined} onChange={(e) => editarData("inicio", e.target.value)} />
        <TextField label="Até" type="date" value={periodo.fim} min={periodo.inicio || undefined} onChange={(e) => editarData("fim", e.target.value)} />
      </div>

      <Tabs tabs={ABAS} value={aba} onChange={(v) => setAba(v as Aba)} aria-label="Relatórios do salão" />

      <div className="analise-conteudo" aria-busy={carregando}>
        {/* Só o status é anunciado: ler as tabelas inteiras a cada carga seria ruído. */}
        <div aria-live="polite">
          {!valido && <Alert tone="warning">{AVISO_PERIODO}</Alert>}
          {valido && erro && <Alert tone="error">{erro}</Alert>}
          {valido && carregando && <p className="analise-nota">Carregando…</p>}
        </div>
        {valido && !carregando && !erro && aba === "cancelamentos" && cancelamentos && <CancelamentosPanel dados={cancelamentos} />}
        {valido && !carregando && !erro && aba === "itens" && itensCancelados && <ItensCanceladosPanel dados={itensCancelados} />}
        {valido && !carregando && !erro && aba === "vendas" && vendas && <VendasPorPessoaPanel dados={vendas} />}
      </div>
    </div>
  );
}
