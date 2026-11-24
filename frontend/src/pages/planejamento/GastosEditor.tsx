import { History, Plus } from "lucide-react";
import { useState } from "react";
import type { PlanejamentoGrupoDeGasto, PlanejamentoLinhaDeGasto, PlanejamentoModoDoGasto, PlanejamentoProjecao, PlanejamentoResultado } from "../../api/client";
import { Button, Select, TextField } from "../../design-system";
import { CampoNumerico } from "./CampoNumerico";
import { useConfirmacao } from "./Confirmacao";
import type { RealizadoDoAnoBase } from "./gastosLeitura";
import { GastosCartoes, GastosTabela, type PropsDasLinhas } from "./GastosLinhas";
import { RealizadoDialog } from "./RealizadoDialog";
import { pagoNoMesPadrao, percentualParaTexto, ROTULO_DO_GRUPO, textoParaPercentual } from "./formato";
import { useLargura } from "./useLargura";

// Gastos do cenário, uma linha por tipo: valor fixo por mês (R$) ou % das vendas. "Todos" preenche os 12 meses de
// uma vez. A folha é informada TOTAL (com o serviço dentro); o serviço abate dela no resultado.

const MAXIMO_DE_LINHAS = 40;
const GRUPOS = Object.keys(ROTULO_DO_GRUPO) as PlanejamentoGrupoDeGasto[];
const OPCOES_DE_GRUPO = GRUPOS.map((g) => ({ value: g, label: ROTULO_DO_GRUPO[g] }));
const OPCOES_DE_MODO: { value: PlanejamentoModoDoGasto; label: string }[] = [
  { value: "FIXO", label: "Valor fixo (R$)" },
  { value: "PERCENTUAL", label: "% das vendas" }
];
const dentroDoPercentual = (v: number) => v >= 0 && v <= 1;
/** Abaixo disso a planilha de meio ano não cabe sem rolar: cada linha vira um cartão com os 12 meses em grade. */
const LARGURA_DA_PLANILHA = 1040;

/** Uma linha zerada por grupo; tributos nasce como % das vendas. Espelha o `linhasPadrao` do servidor. */
export function linhasPadraoDeGasto(): PlanejamentoLinhaDeGasto[] {
  return GRUPOS.map((grupo) => ({ grupo, nome: ROTULO_DO_GRUPO[grupo], modo: grupo === "TRIBUTOS" ? "PERCENTUAL" : "FIXO", valores: Array(12).fill(0) as number[], pagoNoMes: pagoNoMesPadrao(grupo) }));
}

type Props = {
  anoBase: number;
  gastos: PlanejamentoLinhaDeGasto[];
  servicoPercentual: number | null;
  desabilitado: boolean;
  onMudarGastos: (proximos: PlanejamentoLinhaDeGasto[]) => void;
  onMudarServico: (valor: number | null) => void;
  projecao?: PlanejamentoProjecao | null;
  resultado?: PlanejamentoResultado | null;
  realizado?: RealizadoDoAnoBase;
};

export function GastosEditor({ anoBase, gastos, servicoPercentual, desabilitado, onMudarGastos, onMudarServico, projecao, resultado, realizado }: Props) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const [grupo, setGrupo] = useState<PlanejamentoGrupoDeGasto>("OUTROS");
  const [modo, setModo] = useState<PlanejamentoModoDoGasto>("FIXO");
  const [nome, setNome] = useState("");
  const [dialogoRealizado, setDialogoRealizado] = useState(false);
  const { confirmar, dialogo } = useConfirmacao();

  const nomeJaExiste = gastos.some((g) => g.nome.trim().toLowerCase() === nome.trim().toLowerCase());
  const podeAdicionar = !desabilitado && nome.trim() !== "" && !nomeJaExiste && gastos.length < MAXIMO_DE_LINHAS;

  function mudarLinha(indice: number, mes: number | "todos", valor: number | null) {
    const novo = valor ?? 0;
    onMudarGastos(gastos.map((g, i) => (i !== indice ? g : { ...g, valores: g.valores.map((v, m) => (mes === "todos" || m === mes ? novo : v)) })));
  }

  function adicionar() {
    onMudarGastos([...gastos, { grupo, nome: nome.trim(), modo, valores: Array(12).fill(0) as number[], pagoNoMes: pagoNoMesPadrao(grupo) }]);
    setNome("");
  }

  async function redefinirPagoNoMes() {
    const ok = await confirmar({ titulo: "Voltar o % pago no mês ao padrão?", texto: "Vale para todas as linhas, inclusive as que você ajustou à mão. Os valores dos meses não mudam.", acao: "Voltar ao padrão" });
    if (ok) onMudarGastos(gastos.map((g) => ({ ...g, pagoNoMes: pagoNoMesPadrao(g.grupo) })));
  }

  const linhas: PropsDasLinhas = {
    anoBase, gastos, desabilitado, projecao, resultado, realizado,
    onMudarLinha: mudarLinha,
    onMudarPago: (indice, valor) => onMudarGastos(gastos.map((g, i) => (i === indice ? { ...g, pagoNoMes: valor ?? 1 } : g))),
    onRemover: (indice) => onMudarGastos(gastos.filter((_, k) => k !== indice))
  };

  return (
    <div className="plan-gastos">
      <div className="plan-campos-soltos plan-gastos-topo">
        <div className="plan-campo-solto">
          <label className="plan-campo-solto-rotulo" htmlFor="plan-servico">Serviço sobre as vendas</label>
          <span className="plan-campo-com-unidade">
            <CampoNumerico
              id="plan-servico"
              valor={servicoPercentual}
              rotulo="Serviço sobre as vendas, em %"
              desabilitado={desabilitado}
              aceitaVazio
              interpretar={textoParaPercentual}
              formatar={percentualParaTexto}
              valido={dentroDoPercentual}
              onMudar={onMudarServico}
            />
            <span className="plan-unidade" aria-hidden>%</span>
          </span>
          <span className="plan-campo-solto-ajuda">Abate da folha (que é a total, com o serviço dentro). Vazio = não abater.</span>
        </div>
        {!desabilitado && (
          <div className="plan-barra plan-gastos-acoes">
            <Button variant="secondary" onClick={() => setDialogoRealizado(true)}><History size={16} aria-hidden /> Preencher com o realizado de {anoBase}</Button>
            <button type="button" className="plan-link" onClick={() => void redefinirPagoNoMes()}>Redefinir % pago no mês</button>
          </div>
        )}
        {realizado?.erro && <p className="plan-nota-atencao plan-campo-solto-nota">O realizado de {anoBase} por grupo não carregou ({realizado.erro.replace(/\.$/, "")}); as linhas seguem editáveis, só sem a referência.</p>}
      </div>

      {servicoPercentual !== null && servicoPercentual > 0 && !gastos.some((g) => g.grupo === "FOLHA") && (
        <p className="plan-nota-atencao">O serviço só abate de uma linha do grupo Folha de pagamento; sem ela, ele não muda o resultado.</p>
      )}

      <div ref={ref} className="plan-gastos-linhas">
        {largura >= LARGURA_DA_PLANILHA ? <GastosTabela {...linhas} /> : <GastosCartoes {...linhas} />}
      </div>

      {dialogo}
      <RealizadoDialog aberto={dialogoRealizado} anoBase={anoBase} gastos={gastos} onFechar={() => setDialogoRealizado(false)} onAplicar={onMudarGastos} />

      {!desabilitado && (
        <fieldset className="plan-nova-linha">
          <legend className="plan-nova-linha-titulo">Adicionar linha de gasto</legend>
          {gastos.length === 0 && <Button variant="secondary" onClick={() => onMudarGastos(linhasPadraoDeGasto())}>Usar as linhas padrão</Button>}
          <Select label="Grupo" value={grupo} onChange={(e) => setGrupo(e.target.value as PlanejamentoGrupoDeGasto)} options={OPCOES_DE_GRUPO} containerClassName="plan-filtro" />
          <Select label="Forma de cálculo" value={modo} onChange={(e) => setModo(e.target.value as PlanejamentoModoDoGasto)} options={OPCOES_DE_MODO} containerClassName="plan-filtro" />
          <TextField label="Nome da nova linha de gasto" value={nome} maxLength={60} containerClassName="plan-filtro-largo" hint={gastos.length >= MAXIMO_DE_LINHAS ? `Limite de ${MAXIMO_DE_LINHAS} linhas atingido.` : undefined} error={nomeJaExiste ? "Já existe uma linha com esse nome." : undefined} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && podeAdicionar) { e.preventDefault(); adicionar(); } }} />
          <Button variant="secondary" disabled={!podeAdicionar} onClick={adicionar}><Plus size={16} aria-hidden /> Adicionar linha</Button>
        </fieldset>
      )}
    </div>
  );
}
