import { CalendarClock, ChevronLeft, ChevronRight, Plus, Receipt, Settings, Wallet, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  deleteExtraDiaria, deleteExtraPessoa, getExtraDiarias, getExtraPessoas, saveExtraSettings, updateExtraDiaria,
  type ExtraDiaria, type ExtraDiariasMes, type ExtraPessoaFora, type ExtraPessoas, type ExtraStatus,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { DiariaModal, type PessoaEscolhida } from "../components/pessoal/extras/DiariaModal";
import { ExtrasAnalise } from "../components/pessoal/extras/ExtrasAnalise";
import { ExtrasDiarias, type FiltroSituacao } from "../components/pessoal/extras/ExtrasDiarias";
import { ExtrasPagamentos } from "../components/pessoal/extras/ExtrasPagamentos";
import { ExtrasPessoas } from "../components/pessoal/extras/ExtrasPessoas";
import { Janela } from "../components/pessoal/extras/Janela";
import { PessoaForaModal } from "../components/pessoal/extras/PessoaForaModal";
import { STATUS_ROTULO, brl, brlCurto, dataCurta, diariasTexto, hojeIso } from "../components/pessoal/extras/extrasRotulos";
import "../components/pessoal/extras/extras.css";
import { useSession } from "../context/SessionContext";
import { Alert, Button, FormField, FormGrid, SummaryCard, Tabs, TextField } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { maskMoney, moneyToMasked } from "../utils/format";

const numero = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const ABAS = ["diarias", "pagamentos", "pessoas", "analise"] as const;
type Aba = (typeof ABAS)[number];

// Diária gravada → corpo do PUT (para mudar só a situação sem abrir o formulário).
function comoPayload(d: ExtraDiaria, status: ExtraStatus) {
  return {
    date: d.date, employeeId: d.origem === "CASA" ? d.pessoaId : null, extraWorkerId: d.origem === "FORA" ? d.pessoaId : null,
    sector: d.sector, role: d.role, startTime: d.startTime, endTime: d.endTime, duration: d.duration, reason: d.reason,
    coveredEmployeeId: d.coveredEmployeeId, status, baseAmount: d.baseAmount, baseAdjustReason: d.baseAdjustReason,
    transportAmount: d.transportAmount, bonusAmount: d.bonusAmount, discountAmount: d.discountAmount, notes: d.notes,
  };
}

export function Extras() {
  const { user } = useSession();
  const podeCriar = hasPermission(user, "extras", "create");
  const podeEditar = hasPermission(user, "extras", "edit");
  const podeExcluir = hasPermission(user, "extras", "delete");
  const podeAdministrar = hasPermission(user, "extras", "admin");
  const podeAprovar = hasPermission(user, "extras", "approve");
  const { notice, setNotice } = useNotice();

  const hoje = new Date();
  const [year, setYear] = useState(hoje.getFullYear());
  const [month, setMonth] = useState(hoje.getMonth() + 1);
  // Aba no endereço: o cartão "A pagar" e links de fora abrem direto nela.
  const [params, setParams] = useSearchParams();
  const aba: Aba = (ABAS as readonly string[]).includes(params.get("aba") ?? "") ? (params.get("aba") as Aba) : "diarias";
  const irPara = (a: Aba) => setParams(a === "diarias" ? {} : { aba: a }, { replace: true });
  const [situacao, setSituacao] = useState<FiltroSituacao>("TODAS");

  const [dados, setDados] = useState<ExtraDiariasMes | null>(null);
  const [pessoas, setPessoas] = useState<ExtraPessoas | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [lancando, setLancando] = useState<{ diaria: ExtraDiaria | null; pessoa?: PessoaEscolhida | null } | null>(null);
  const [editandoFora, setEditandoFora] = useState<ExtraPessoaFora | "nova" | null>(null);
  const [excluindo, setExcluindo] = useState<ExtraDiaria | null>(null);
  const [motivoExclusao, setMotivoExclusao] = useState("");
  const [excluindoFora, setExcluindoFora] = useState<ExtraPessoaFora | null>(null);
  const [configurando, setConfigurando] = useState<{ inteira: string; meia: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const recarregarPessoas = useCallback(async () => {
    const p = await getExtraPessoas(true);
    setPessoas(p);
    return p;
  }, []);

  // Trocar de mês rápido dispara várias cargas; só a última pode escrever na
  // tela, senão uma resposta lenta mostraria outro mês sob o rótulo atual.
  const cargaAtual = useRef(0);
  const carregar = useCallback(async () => {
    const minha = ++cargaAtual.current;
    setCarregando(true);
    setErro(null);
    try {
      const [d] = await Promise.all([getExtraDiarias(year, month), recarregarPessoas()]);
      if (minha === cargaAtual.current) setDados(d);
    } catch (e) {
      if (minha === cargaAtual.current) setErro(e instanceof Error ? e.message : "Não foi possível carregar os extras.");
    } finally {
      if (minha === cargaAtual.current) setCarregando(false);
    }
  }, [year, month, recarregarPessoas]);

  useEffect(() => { void carregar(); }, [carregar]);
  // Sem botão de recarregar: ao voltar para a aba (outro aparelho lançou algo),
  // a tela busca de novo sozinha.
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === "visible") void carregar(); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [carregar]);

  function mudarMes(delta: number) {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }

  async function executar(acao: () => Promise<unknown>, sucesso: string, depois?: () => void) {
    setOcupado(true);
    try {
      await acao();
      depois?.();
      setNotice({ tone: "success", message: sucesso });
      void carregar();
    } catch (e) {
      setNotice({ tone: "error", message: e instanceof Error ? e.message : "Não foi possível concluir." });
    } finally {
      setOcupado(false);
    }
  }

  const mudarSituacao = (d: ExtraDiaria, status: ExtraStatus) =>
    void executar(() => updateExtraDiaria(d.id, comoPayload(d, status)), `${d.pessoaNome} · ${dataCurta(d.date)}: ${STATUS_ROTULO[status].toLowerCase()}.`);

  function confirmarExclusao() {
    if (!excluindo) return;
    if (motivoExclusao.trim().length < 3) return setNotice({ tone: "error", message: "Informe o motivo da exclusão (mín. 3 caracteres)." });
    void executar(() => deleteExtraDiaria(excluindo.id, motivoExclusao.trim()), "Diária excluída.", () => { setExcluindo(null); setMotivoExclusao(""); });
  }

  function salvarValores() {
    if (!configurando) return;
    const inteira = Number(configurando.inteira.replace(/\./g, "").replace(",", "."));
    const meia = Number(configurando.meia.replace(/\./g, "").replace(",", "."));
    void executar(() => saveExtraSettings({ diariaValor: inteira, meiaDiariaValor: meia }), "Valores da diária atualizados. Valem para os próximos lançamentos.", () => setConfigurando(null));
  }

  const mesRotulo = `${MESES[month - 1]}/${year}`;
  // Só mostra os dados se forem do mês escolhido: ao trocar de mês, os números
  // antigos não ficam sob o nome do mês novo enquanto a resposta não chega.
  const doMes = dados && dados.year === year && dados.month === month ? dados : null;
  const r = doMes?.resumo;
  const itens = doMes?.itens ?? [];
  // Realizadas do mês ainda não pagas (sem pagamento ou com título em aberto).
  const aPagar = itens.filter((d) => d.status === "REALIZADA" && !d.pago).reduce((s, d) => s + d.totalAmount, 0);
  const qtdPrevistas = itens.filter((d) => d.status === "PREVISTA").length;
  // O aviso só acende no dia seguinte: a diária de hoje à noite ainda não aconteceu.
  const pendentesDeConfirmar = itens.filter((d) => d.status === "PREVISTA" && d.date < hojeIso()).length;

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel extras-topo">
        <div className="extras-barra-topo">
          <div className="extras-mes" role="group" aria-label="Mês">
            <Button variant="secondary" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
            <input
              type="month"
              className="extras-mes-campo"
              value={`${year}-${String(month).padStart(2, "0")}`}
              onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) { setYear(y); setMonth(m); } }}
              aria-label="Mês e ano"
            />
            <Button variant="secondary" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
          </div>
          <div className="extras-acoes-topo">
            {dados && (
              podeAdministrar ? (
                <button type="button" className="extras-valor-diaria" onClick={() => setConfigurando({ inteira: moneyToMasked(dados.padrao.inteira), meia: moneyToMasked(dados.padrao.meia) })} title="Valor da diária inteira e da meia diária. Clique para alterar." aria-label={`Valor da diária: ${brl(dados.padrao.inteira)}, meia ${brl(dados.padrao.meia)}. Alterar`}>
                  <Settings size={14} aria-hidden="true" /> {brlCurto(dados.padrao.inteira)} · meia {brlCurto(dados.padrao.meia)}
                </button>
              ) : (
                <span className="extras-valor-diaria extras-valor-diaria--leitura">{brlCurto(dados.padrao.inteira)} · meia {brlCurto(dados.padrao.meia)}</span>
              )
            )}
            {podeCriar && <Button leadingIcon={<Plus size={15} />} onClick={() => setLancando({ diaria: null })} disabled={!pessoas}>Lançar diária</Button>}
          </div>
        </div>

        {erro && <Alert tone="error">{erro}</Alert>}

        {r && (
          <div className="extras-resumo">
            <SummaryCard compact label={`Gasto em ${MESES[month - 1]}`} moneyValue={r.custoRealizado} icon={<Wallet size={16} />}
              detail={<><span>{diariasTexto(r.diariasRealizadas)}</span><span className="extras-detalhe-origem" title={`Casa ${brl(r.custoCasa)} · De fora ${brl(r.custoFora)}`}><span>Casa {numero(r.custoCasa)}</span><span>Fora {numero(r.custoFora)}</span></span>{r.diferencaPaga !== 0 && <span title="Pagamentos baixados por valor diferente do título">{r.diferencaPaga > 0 ? "+" : "−"} {numero(Math.abs(r.diferencaPaga))} de diferença paga</span>}</>} />
            <SummaryCard
              compact className="extras-cartao-link" role="link" tabIndex={0}
              aria-label={`A pagar: ${brl(aPagar)}. Abrir pagamentos`}
              onClick={() => irPara("pagamentos")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); irPara("pagamentos"); } }}
              label="A pagar" moneyValue={aPagar} tone={aPagar > 0 ? "warning" : "success"} icon={<Receipt size={16} />} detail={aPagar > 0 ? "Abrir pagamentos →" : "Tudo pago"}
            />
            <SummaryCard compact label="Previsto" moneyValue={r.custoPrevisto} tone="info" icon={<CalendarClock size={16} />} detail={qtdPrevistas ? `${qtdPrevistas} lançamento(s)` : "Nada agendado"} />
            <SummaryCard compact label="Não compareceu" value={String(r.naoCompareceu)} tone={r.naoCompareceu > 0 ? "danger" : "neutral"} icon={<XCircle size={16} />} detail="Chamados que faltaram" />
          </div>
        )}

        {pendentesDeConfirmar > 0 && (
          <Alert tone="warning" className="extras-aviso">
            {pendentesDeConfirmar === 1 ? "1 diária prevista já chegou na data" : `${pendentesDeConfirmar} diárias previstas já chegaram na data`}: confirme se a pessoa veio para o gasto do mês ficar certo.{" "}
            <button type="button" className="extras-link-botao" onClick={() => { setSituacao("PREVISTA"); irPara("diarias"); }}>Ver e confirmar</button>
          </Alert>
        )}
      </section>

      <Tabs
        value={aba}
        onChange={(v) => irPara(v as Aba)}
        tabs={[
          { value: "diarias", label: "Diárias do mês" },
          { value: "pagamentos", label: "Pagamentos" },
          { value: "pessoas", label: "Pessoas" },
          { value: "analise", label: "Análise" },
        ]}
      />

      {aba === "diarias" && (
        <ExtrasDiarias
          itens={itens}
          carregando={carregando || !doMes}
          mesRotulo={mesRotulo}
          situacao={situacao}
          onSituacao={setSituacao}
          podeCriar={podeCriar}
          podeEditar={podeEditar}
          podeExcluir={podeExcluir}
          onLancar={() => setLancando({ diaria: null })}
          onEditar={(d) => setLancando({ diaria: d })}
          onExcluir={(d) => { setMotivoExclusao(""); setExcluindo(d); }}
          onMudarSituacao={mudarSituacao}
          ocupado={ocupado}
        />
      )}

      {aba === "pagamentos" && (
        <ExtrasPagamentos year={year} month={month} mesRotulo={mesRotulo} podeAprovar={podeAprovar} podeCancelar={podeExcluir} setNotice={setNotice} onMudou={() => void carregar()} />
      )}

      {aba === "pessoas" && pessoas && doMes && (
        <ExtrasPessoas
          pessoas={pessoas}
          diarias={itens}
          mesRotulo={MESES[month - 1]}
          podeCriar={podeCriar}
          podeEditar={podeEditar}
          podeExcluir={podeExcluir}
          onLancar={(p) => setLancando({ diaria: null, pessoa: p })}
          onNovaFora={() => setEditandoFora("nova")}
          onEditarFora={(p) => setEditandoFora(p)}
          onExcluirFora={(p) => setExcluindoFora(p)}
        />
      )}

      {aba === "analise" && r && <ExtrasAnalise resumo={r} itens={itens} mesRotulo={mesRotulo} />}

      {lancando && pessoas && dados && (
        <DiariaModal
          diaria={lancando.diaria}
          pessoas={pessoas}
          padrao={dados.padrao}
          pessoaInicial={lancando.pessoa ?? null}
          podeCadastrarPessoa={podeCriar}
          onRecarregarPessoas={recarregarPessoas}
          onFechar={() => setLancando(null)}
          onLancouOutra={() => void carregar()}
          onSalvo={() => {
            setLancando(null);
            setNotice({ tone: "success", message: lancando.diaria ? "Diária atualizada." : "Diária lançada." });
            void carregar();
          }}
        />
      )}

      {editandoFora && pessoas && (
        <PessoaForaModal
          pessoa={editandoFora === "nova" ? null : editandoFora}
          podeVerDados={pessoas.podeVerDados}
          onFechar={() => setEditandoFora(null)}
          onSalvo={() => {
            setEditandoFora(null);
            setNotice({ tone: "success", message: "Cadastro salvo." });
            void recarregarPessoas();
          }}
        />
      )}

      {excluindo && (
        <Janela titulo="Excluir diária" onFechar={() => setExcluindo(null)} ocupado={ocupado}>
          <p style={{ marginTop: 0 }}><strong>{excluindo.pessoaNome}</strong> · {dataCurta(excluindo.date)} · {brl(excluindo.totalAmount)}</p>
          <p className="extras-sub">Se a pessoa não veio, prefira marcar "Não compareceu": o registro continua no histórico.</p>
          <FormField label="Motivo da exclusão" required>
            <TextField value={motivoExclusao} onChange={(e) => setMotivoExclusao(e.target.value)} autoFocus placeholder="Ex.: lançada em duplicidade" />
          </FormField>
          <div className="extras-acoes">
            <Button variant="secondary" onClick={() => setExcluindo(null)} disabled={ocupado}>Cancelar</Button>
            <Button variant="danger" onClick={confirmarExclusao} disabled={ocupado}>Excluir diária</Button>
          </div>
        </Janela>
      )}

      {excluindoFora && (
        <Janela titulo="Excluir cadastro" onFechar={() => setExcluindoFora(null)} ocupado={ocupado}>
          <p style={{ marginTop: 0 }}>Excluir o cadastro de <strong>{excluindoFora.nome}</strong>?</p>
          <p className="extras-sub">Só é possível para quem ainda não tem diária lançada. Para quem já trabalhou, desative o cadastro em "Editar cadastro".</p>
          <div className="extras-acoes">
            <Button variant="secondary" onClick={() => setExcluindoFora(null)} disabled={ocupado}>Cancelar</Button>
            <Button variant="danger" disabled={ocupado} onClick={() => void executar(() => deleteExtraPessoa(excluindoFora.id), "Cadastro excluído.", () => setExcluindoFora(null))}>Excluir cadastro</Button>
          </div>
        </Janela>
      )}

      {configurando && (
        <Janela eyebrow="Extras · configuração" titulo="Valor da diária" onFechar={() => setConfigurando(null)} ocupado={ocupado}>
          <p className="extras-sub" style={{ marginTop: 0 }}>Vale para todos. Diárias já lançadas guardam o valor do dia e não mudam.</p>
          <FormGrid cols={2}>
            <FormField label="Diária inteira">
              <TextField value={configurando.inteira} inputMode="numeric" onChange={(e) => setConfigurando({ ...configurando, inteira: maskMoney(e.target.value) })} />
            </FormField>
            <FormField label="Meia diária">
              <TextField value={configurando.meia} inputMode="numeric" onChange={(e) => setConfigurando({ ...configurando, meia: maskMoney(e.target.value) })} />
            </FormField>
          </FormGrid>
          <div className="extras-acoes">
            <Button variant="secondary" onClick={() => setConfigurando(null)} disabled={ocupado}>Cancelar</Button>
            <Button onClick={salvarValores} disabled={ocupado}>Salvar valores</Button>
          </div>
        </Janela>
      )}
    </div>
  );
}
