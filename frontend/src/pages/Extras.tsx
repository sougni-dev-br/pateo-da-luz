import { AlertTriangle, CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Plus, Receipt, Settings, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  deleteExtraDiaria, deleteExtraPessoa, getExtraDiarias, getExtraHabitualidade, getExtraPessoas, saveExtraSettings, updateExtraDiaria,
  type ExtraDiaria, type ExtraDiariasMes, type ExtraHabitualidade, type ExtraPessoaFora, type ExtraPessoas, type ExtraStatus,
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { DiariaModal, type PessoaEscolhida } from "../components/pessoal/extras/DiariaModal";
import { ExtrasAnalise } from "../components/pessoal/extras/ExtrasAnalise";
import { ExtrasDiarias, type FiltroSituacao } from "../components/pessoal/extras/ExtrasDiarias";
import { ExtrasPagamentos } from "../components/pessoal/extras/ExtrasPagamentos";
import { ExtrasPainel } from "../components/pessoal/extras/ExtrasPainel";
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
const ABAS = ["diarias", "pagamentos", "pessoas", "painel"] as const;
type Aba = (typeof ABAS)[number];

// Quanto do gasto foi da equipe da casa e quanto de freelancers: as mesmas
// cores do gráfico do Painel, para a leitura ser uma só nas duas telas.
function DivisaoCasaFora({ casa, fora }: { casa: number; fora: number }) {
  const total = casa + fora;
  const pctCasa = total > 0 ? (casa / total) * 100 : 0;
  return (
    <span className="extras-divisao" title={`Equipe da casa ${brl(casa)} · Freelancers ${brl(fora)}`}>
      <span className="extras-divisao-barra" aria-hidden="true">
        {casa > 0 && <i className="casa" style={{ width: `${pctCasa}%` }} />}
        {fora > 0 && <i className="fora" style={{ width: `${100 - pctCasa}%` }} />}
      </span>
      <span className="extras-divisao-legenda">
        <span><i className="casa" aria-hidden="true" />Equipe {numero(casa)}</span>
        <span><i className="fora" aria-hidden="true" />Freelancers {numero(fora)}</span>
      </span>
    </span>
  );
}

// Diária gravada → corpo do PUT (para mudar só a situação sem abrir o formulário).
function comoPayload(d: ExtraDiaria, status: ExtraStatus) {
  return {
    date: d.date, employeeId: d.origem === "CASA" ? d.pessoaId : null, extraWorkerId: d.origem === "FORA" ? d.pessoaId : null,
    sector: d.sector, role: d.role, startTime: d.startTime, endTime: d.endTime, duration: d.duration, reason: d.reason, eventName: d.eventName,
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
  const campoMes = useRef<HTMLInputElement>(null);
  // Aba no endereço: o cartão "A pagar" e links de fora abrem direto nela.
  const [params, setParams] = useSearchParams();
  // "analise" era o nome antigo da aba: links salvos continuam abrindo o painel.
  const abaPedida = params.get("aba") === "analise" ? "painel" : params.get("aba") ?? "";
  const aba: Aba = (ABAS as readonly string[]).includes(abaPedida) ? (abaPedida as Aba) : "diarias";
  const irPara = (a: Aba) => setParams(a === "diarias" ? {} : { aba: a }, { replace: true });
  const [situacao, setSituacao] = useState<FiltroSituacao>("TODAS");

  const [dados, setDados] = useState<ExtraDiariasMes | null>(null);
  const [pessoas, setPessoas] = useState<ExtraPessoas | null>(null);
  const [habitualidade, setHabitualidade] = useState<ExtraHabitualidade | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const [lancando, setLancando] = useState<{ diaria: ExtraDiaria | null; pessoa?: PessoaEscolhida | null } | null>(null);
  const [editandoFora, setEditandoFora] = useState<ExtraPessoaFora | "nova" | null>(null);
  const [excluindo, setExcluindo] = useState<ExtraDiaria | null>(null);
  const [motivoExclusao, setMotivoExclusao] = useState("");
  const [excluindoFora, setExcluindoFora] = useState<ExtraPessoaFora | null>(null);
  const [configurando, setConfigurando] = useState<{ inteira: string; meia: string; porSemana: string; em30Dias: string; semanasSeguidas: string } | null>(null);
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
      // O aviso de frequência é complemento: se falhar, a tela do mês abre igual.
      const [d, h] = await Promise.all([getExtraDiarias(year, month), getExtraHabitualidade().catch(() => null), recarregarPessoas()]);
      if (minha === cargaAtual.current) { setDados(d); setHabitualidade(h); }
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
    const habitual = { porSemana: Number(configurando.porSemana), em30Dias: Number(configurando.em30Dias), semanasSeguidas: Number(configurando.semanasSeguidas) };
    void executar(() => saveExtraSettings({ diariaValor: inteira, meiaDiariaValor: meia, habitualidade: habitual }), "Configuração salva. Os valores valem para os próximos lançamentos.", () => setConfigurando(null));
  }

  function abrirConfiguracao() {
    if (!dados) return;
    const lim = habitualidade?.limites ?? { porSemana: 3, em30Dias: 8, semanasSeguidas: 4 };
    setConfigurando({
      inteira: moneyToMasked(dados.padrao.inteira), meia: moneyToMasked(dados.padrao.meia),
      porSemana: String(lim.porSemana), em30Dias: String(lim.em30Dias), semanasSeguidas: String(lim.semanasSeguidas),
    });
  }

  const mesRotulo = `${MESES[month - 1]}/${year}`;
  const noMesAtual = year === hoje.getFullYear() && month === hoje.getMonth() + 1;
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
  const emRisco = habitualidade?.pessoas.filter((p) => p.emRisco) ?? [];
  const idsEmRisco = new Set(emRisco.map((p) => p.id));

  return (
    <div className="stack">
      <Notice notice={notice} />

      <section className="panel extras-topo">
        <div className="extras-barra-topo">
          <div className="extras-mes" role="group" aria-label="Mês">
            <Button variant="secondary" onClick={() => mudarMes(-1)} aria-label="Mês anterior"><ChevronLeft size={16} /></Button>
            {/* O campo nativo cortava o ano ("setembro de 202"): o texto fica num
                rótulo nosso e o campo, invisível por cima, só abre o seletor. */}
            <label className="extras-mes-campo">
              <span aria-hidden="true">{MESES[month - 1]} <b>{year}</b></span>
              <CalendarDays size={15} aria-hidden="true" />
              <input
                ref={campoMes}
                type="month"
                value={`${year}-${String(month).padStart(2, "0")}`}
                onClick={() => { try { campoMes.current?.showPicker?.(); } catch { /* navegador sem showPicker: o toque abre o seletor */ } }}
                onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); if (y && m) { setYear(y); setMonth(m); } }}
                aria-label={`Mês: ${mesRotulo}. Trocar mês`}
              />
            </label>
            <Button variant="secondary" onClick={() => mudarMes(1)} aria-label="Próximo mês"><ChevronRight size={16} /></Button>
            {!noMesAtual && (
              <button type="button" className="extras-mes-hoje" onClick={() => { setYear(hoje.getFullYear()); setMonth(hoje.getMonth() + 1); }}>
                Mês atual
              </button>
            )}
          </div>
          <div className="extras-acoes-topo">
            {dados && (
              podeAdministrar ? (
                <button type="button" className="extras-valor-diaria" onClick={abrirConfiguracao} title="Valor da diária inteira e da meia diária. Clique para alterar." aria-label={`Valor da diária: ${brl(dados.padrao.inteira)}, meia ${brl(dados.padrao.meia)}. Alterar`}>
                  <Settings size={14} aria-hidden="true" /> <span className="extras-rotulo-botao">Diária</span> {brlCurto(dados.padrao.inteira)} · meia {brlCurto(dados.padrao.meia)}
                </button>
              ) : (
                <span className="extras-valor-diaria extras-valor-diaria--leitura"><span className="extras-rotulo-botao">Diária</span> {brlCurto(dados.padrao.inteira)} · meia {brlCurto(dados.padrao.meia)}</span>
              )
            )}
            {podeCriar && <Button leadingIcon={<Plus size={15} />} onClick={() => setLancando({ diaria: null })} disabled={!pessoas}>Lançar diária</Button>}
          </div>
        </div>

        {erro && <Alert tone="error">{erro}</Alert>}

        {r && (
          <div className="extras-resumo">
            <SummaryCard compact className="extras-cartao-principal" label={`Gasto em ${MESES[month - 1]}`} moneyValue={r.custoRealizado} icon={<Wallet size={16} />}
              detail={r.diariasRealizadas === 0 && r.naoCompareceu === 0 ? "Nenhuma diária realizada ainda" : (
                <>
                  <span>
                    {diariasTexto(r.diariasRealizadas)}
                    {r.naoCompareceu > 0 && <span className="extras-faltas"> · {r.naoCompareceu === 1 ? "1 não compareceu" : `${r.naoCompareceu} não compareceram`}</span>}
                  </span>
                  {r.custoRealizado > 0 && <DivisaoCasaFora casa={r.custoCasa} fora={r.custoFora} />}
                  {r.diferencaPaga !== 0 && <span title="Pagamentos baixados por valor diferente do título">{r.diferencaPaga > 0 ? "+" : "−"} {numero(Math.abs(r.diferencaPaga))} de diferença paga</span>}
                </>
              )} />
            <SummaryCard
              compact className="extras-cartao-link" role="link" tabIndex={0}
              aria-label={`A pagar: ${brl(aPagar)}. Abrir pagamentos`}
              onClick={() => irPara("pagamentos")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); irPara("pagamentos"); } }}
              label="A pagar" moneyValue={aPagar} tone={aPagar > 0 ? "warning" : "success"} icon={<Receipt size={16} />} detail={aPagar > 0 ? "Abrir pagamentos →" : "Tudo pago"}
            />
            <SummaryCard compact label="Previsto" moneyValue={r.custoPrevisto} tone="info" icon={<CalendarClock size={16} />} detail={qtdPrevistas ? (qtdPrevistas === 1 ? "1 diária agendada" : `${qtdPrevistas} diárias agendadas`) : "Nada agendado"} />
          </div>
        )}

        {pendentesDeConfirmar > 0 && (
          <Alert tone="warning" className="extras-aviso">
            {pendentesDeConfirmar === 1 ? "1 diária prevista já chegou na data" : `${pendentesDeConfirmar} diárias previstas já chegaram na data`}: confirme se a pessoa veio para o gasto do mês ficar certo.{" "}
            <button type="button" className="extras-link-botao" onClick={() => { setSituacao("PREVISTA"); irPara("diarias"); }}>Ver e confirmar</button>
          </Alert>
        )}

        {emRisco.length > 0 && aba !== "painel" && (
          <Alert tone="warning" icon={<AlertTriangle size={16} />} className="extras-aviso">
            {emRisco.length === 1 ? `${emRisco[0].nome} está` : `${emRisco.length} freelancers estão`} com diárias frequentes (risco de vínculo).{" "}
            <button type="button" className="extras-link-botao" onClick={() => irPara("painel")}>Ver frequência</button>
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
          { value: "painel", label: "Painel" },
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
          emRisco={idsEmRisco}
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

      {aba === "painel" && (
        <>
          <ExtrasPainel
            ate={`${year}-${String(month).padStart(2, "0")}`}
            habitualidade={habitualidade}
            podeAjustarCriterios={podeAdministrar && !!dados}
            onAjustarCriterios={abrirConfiguracao}
          />
          {r && <ExtrasAnalise resumo={r} itens={itens} mesRotulo={mesRotulo} />}
        </>
      )}

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
        <Janela eyebrow="Extras · configuração" titulo="Diária e frequência" onFechar={() => setConfigurando(null)} ocupado={ocupado}>
          <p className="extras-sub" style={{ marginTop: 0 }}>Vale para todos. Diárias já lançadas guardam o valor do dia e não mudam.</p>
          <FormGrid cols={2}>
            <FormField label="Diária inteira">
              <TextField value={configurando.inteira} inputMode="numeric" onChange={(e) => setConfigurando({ ...configurando, inteira: maskMoney(e.target.value) })} />
            </FormField>
            <FormField label="Meia diária">
              <TextField value={configurando.meia} inputMode="numeric" onChange={(e) => setConfigurando({ ...configurando, meia: maskMoney(e.target.value) })} />
            </FormField>
          </FormGrid>
          <h3 className="extras-config-titulo">Aviso de frequência (freelancers)</h3>
          <p className="extras-sub" style={{ marginTop: 0 }}>O aviso acende quando a pessoa atinge qualquer um destes limites. Só avisa, nunca bloqueia.</p>
          <FormGrid cols={3}>
            <FormField label="Dias na mesma semana" hint="1 a 7">
              <TextField type="number" min={1} max={7} value={configurando.porSemana} onChange={(e) => setConfigurando({ ...configurando, porSemana: e.target.value })} />
            </FormField>
            <FormField label="Dias em 30 dias" hint="1 a 30">
              <TextField type="number" min={1} max={30} value={configurando.em30Dias} onChange={(e) => setConfigurando({ ...configurando, em30Dias: e.target.value })} />
            </FormField>
            <FormField label="Semanas seguidas" hint="2 a 52">
              <TextField type="number" min={2} max={52} value={configurando.semanasSeguidas} onChange={(e) => setConfigurando({ ...configurando, semanasSeguidas: e.target.value })} />
            </FormField>
          </FormGrid>
          <div className="extras-acoes">
            <Button variant="secondary" onClick={() => setConfigurando(null)} disabled={ocupado}>Cancelar</Button>
            <Button onClick={salvarValores} disabled={ocupado}>Salvar</Button>
          </div>
        </Janela>
      )}
    </div>
  );
}
