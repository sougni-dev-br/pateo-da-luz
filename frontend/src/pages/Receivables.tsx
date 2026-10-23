import { AlertTriangle, Ban, CheckCircle2, Plus, RefreshCw, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelReceivable,
  createReceivable,
  markReceivableReceived,
  reverseReceivableReceipt,
  type AppUser,
  type ReceivableDetail,
  type ReceivableReceiptView,
  type ReceivableSourceType,
  type ReceivableView
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Alert, Button, EmptyState, IconButton, Money, PanelEyebrow, Select } from "../design-system";
import { hojeLocalIso } from "../lib/datas";
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";
import { DetalheConta } from "./receivables/DetalheConta";
import { ListaContas } from "./receivables/ListaContas";
import { ModalLote } from "./receivables/ModalLote";
import { ModalMotivo } from "./receivables/ModalMotivo";
import { ModalNova, type ValoresDaNovaConta } from "./receivables/ModalNova";
import { ModalReceber, type ValoresDoRecebimento } from "./receivables/ModalReceber";
import { PanoramaReceber } from "./receivables/PanoramaReceber";
import {
  agruparPorMes, agruparPorUrgencia, aplicarDia, aplicarFoco, aplicarOrigem, contagemPorOrigem, diasDaAgenda,
  estaPendente, filtrarPorBusca, ORIGEM_ROTULO, ORIGENS, periodoDoPreset, PRESETS_PERIODO, rotuloDoPeriodo,
  tituloDaConta, VISTAS, type Foco, type PresetPeriodo, type Vista
} from "./receivables/regras";
import { LIMITE_DA_LISTA, useContasReceber } from "./receivables/useContasReceber";
import "./payables/payables.css";
import "./receivables/receivables.css";

type Acao =
  | { tipo: "receber"; conta: ReceivableView }
  | { tipo: "cancelar"; conta: ReceivableView }
  | { tipo: "estornar"; conta: ReceivableView; recebimento: ReceivableReceiptView }
  | { tipo: "lote"; ids: string[] }
  | { tipo: "nova" };

const ROTULO_FOCO: Record<Foco, string> = { atrasadas: "Atrasadas", hoje: "Previstas para hoje", proximos7: "Próximos 7 dias", proximos30: "Próximos 30 dias" };

export function Receivables({ user }: { user: AppUser }) {
  const podeReceber = hasPermission(user, "receivables", "create");
  const podeDesfazer = hasPermission(user, "receivables", "delete");

  const [vista, setVista] = useState<Vista>("pendentes");
  const [preset, setPreset] = useState<PresetPeriodo>("mes");
  const [datas, setDatas] = useState({ startDate: "", endDate: "" });
  const [origem, setOrigem] = useState<ReceivableSourceType | "all">("all");
  const [foco, setFoco] = useState<Foco | null>(null);
  const [diaFoco, setDiaFoco] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [acao, setAcao] = useState<Acao | null>(null);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const { notice, setNotice } = useNotice();
  const buscaRef = useRef<HTMLInputElement>(null);

  const hojeLocal = useMemo(() => hojeLocalIso(), []);
  const periodo = useMemo(() => (preset === "custom" ? datas : periodoDoPreset(preset, hojeLocal)), [preset, datas, hojeLocal]);
  const { resumo, pendentes, historico, carregando, erro, truncado, recarregar } = useContasReceber(vista, periodo);
  const hoje = resumo?.today ?? hojeLocal;

  // "/" leva à busca, como em Contas a Pagar.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (alvo && (alvo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName))) return;
      e.preventDefault();
      buscaRef.current?.focus();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  const base = vista === "pendentes" ? pendentes : historico;
  const buscadas = useMemo(() => filtrarPorBusca(base, busca), [base, busca]);
  const porOrigem = useMemo(() => contagemPorOrigem(buscadas), [buscadas]);
  const exibidas = useMemo(() => {
    const daOrigem = aplicarOrigem(buscadas, origem);
    return vista === "pendentes" ? aplicarDia(aplicarFoco(daOrigem, foco, hoje), diaFoco) : daOrigem;
  }, [buscadas, origem, vista, foco, diaFoco, hoje]);
  const grupos = useMemo(() => (vista === "pendentes" ? agruparPorUrgencia(exibidas, hoje) : agruparPorMes(exibidas)), [exibidas, vista, hoje]);
  const agenda = useMemo(() => diasDaAgenda(pendentes, hoje), [pendentes, hoje]);

  const totalExibido = useMemo(() => grupos.reduce((s, g) => s + Math.round(g.total * 100), 0) / 100, [grupos]);
  const temFiltro = Boolean(busca || foco || diaFoco || origem !== "all");
  const selecionaveis = useMemo(() => exibidas.filter(estaPendente), [exibidas]);
  const escolhidas = useMemo(() => pendentes.filter((c) => selecionados.has(c.id)), [pendentes, selecionados]);
  const totalEscolhido = escolhidas.reduce((s, c) => s + Math.round(c.remainingAmount * 100), 0) / 100;

  function limparFiltros() {
    setBusca("");
    setFoco(null);
    setDiaFoco(null);
    setOrigem("all");
  }

  function trocarVista(nova: Vista) {
    setVista(nova);
    setFoco(null);
    setDiaFoco(null);
    setSelecionados(new Set());
  }

  function alternarFoco(f: Foco) {
    setVista("pendentes");
    setDiaFoco(null);
    setFoco((atual) => (atual === f && vista === "pendentes" ? null : f));
  }

  function alternarDia(chave: string) {
    setVista("pendentes");
    setFoco(null);
    setDiaFoco((atual) => (atual === chave && vista === "pendentes" ? null : chave));
  }

  function verRecebidoNoMes() {
    setVista("recebidas");
    setPreset("mes");
    setFoco(null);
    setDiaFoco(null);
  }

  function alternar(id: string) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  }

  function alternarGrupo(ids: string[], marcar: boolean) {
    setSelecionados((atual) => {
      const novo = new Set(atual);
      for (const id of ids) { if (marcar) novo.add(id); else novo.delete(id); }
      return novo;
    });
  }

  // Depois de qualquer ação: recarrega a lista e o detalhe aberto.
  async function aposAcao(mensagem: string) {
    setNotice({ tone: "success", message: mensagem });
    setAcao(null);
    setSelecionados(new Set());
    setVersao((v) => v + 1);
    await recarregar();
  }

  async function receber(conta: ReceivableView, v: ValoresDoRecebimento) {
    await markReceivableReceived(conta.id, {
      receivedDate: v.receivedDate,
      paidAmount: v.paidAmount,
      paymentMethod: v.paymentMethod || null,
      notes: v.notes || null,
      differenceReason: v.differenceReason || null
    });
    await aposAcao(`Recebimento registrado: ${tituloDaConta(conta.description)}`);
  }

  async function lancar(v: ValoresDaNovaConta) {
    await createReceivable({
      sourceType: v.sourceType,
      description: v.description,
      customerName: v.customerName || null,
      expectedDate: v.expectedDate,
      grossAmount: v.grossAmount,
      fees: v.fees,
      netAmount: v.netAmount,
      notes: v.notes || null
    });
    await aposAcao(`Conta lançada: ${v.description}`);
  }

  async function cancelar(conta: ReceivableView, motivo: string) {
    await cancelReceivable(conta.id, motivo);
    await aposAcao(`Conta cancelada: ${tituloDaConta(conta.description)}`);
  }

  async function estornar(conta: ReceivableView, recebimento: ReceivableReceiptView, motivo: string) {
    await reverseReceivableReceipt(conta.id, recebimento.id, motivo);
    await aposAcao(`Recebimento estornado: ${tituloDaConta(conta.description)}`);
  }

  const contexto = (c: ReceivableView) => (
    <>
      <div><span>Origem</span><strong>{ORIGEM_ROTULO[c.sourceType]}</strong></div>
      <div><span>Previsto</span><strong>{formatDate(c.expectedDate)}</strong></div>
      <div className="pg-ctx-valor"><span>Valor</span><strong className="pay-ctx-amount"><Money value={c.netAmount} /></strong></div>
    </>
  );

  const periodoTexto = vista === "pendentes" ? "Tudo que falta receber" : preset === "tudo" ? "Todo o período" : preset === "custom" ? `${formatDate(periodo.startDate)} a ${formatDate(periodo.endDate)}` : `${rotuloDoPeriodo(preset)} · ${formatDate(periodo.startDate)} a ${formatDate(periodo.endDate)}`;

  return (
    <section className="panel pg-tela rc-tela">
      <Notice notice={notice} />

      <div className="pg-topo">
        <PanelEyebrow>Resumo de recebimentos</PanelEyebrow>
        <div className="pg-topo-acoes">
          {podeReceber && <Button size="sm" leadingIcon={<Plus size={15} />} onClick={() => setAcao({ tipo: "nova" })}>Nova conta</Button>}
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar" size="sm" onClick={() => void recarregar()} disabled={carregando} />
        </div>
      </div>

      <PanoramaReceber
        resumo={resumo}
        agenda={agenda}
        hoje={hoje}
        carregando={carregando}
        foco={vista === "pendentes" ? foco : null}
        recebidoAtivo={vista === "recebidas" && preset === "mes"}
        diaFoco={vista === "pendentes" ? diaFoco : null}
        onFoco={alternarFoco}
        onRecebidoMes={verRecebidoNoMes}
        onDia={alternarDia}
      />

      <div className="pg-barra">
        <div className="pg-busca">
          <Search size={16} aria-hidden="true" />
          <input
            ref={buscaRef}
            type="search"
            aria-label="Buscar contas a receber"
            placeholder="Buscar descrição, cliente, referência ou valor…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setBusca(""); }}
          />
          {!busca && <kbd className="pg-atalho-tecla" aria-hidden="true" title="Atalho: tecla /">/</kbd>}
          {busca && (
            <button type="button" className="pg-busca-limpar" onClick={() => setBusca("")} aria-label="Limpar busca"><X size={14} /></button>
          )}
        </div>
        {temFiltro && <button type="button" className="pg-link" onClick={limparFiltros}>Limpar filtros</button>}
      </div>

      <div className="pg-vistas">
        <div className="pg-segmento" role="group" aria-label="Situação das contas">
          {VISTAS.map((v) => (
            <button key={v.chave} type="button" aria-pressed={vista === v.chave} onClick={() => trocarVista(v.chave)}>{v.rotulo}</button>
          ))}
        </div>
        {vista !== "pendentes" && (
          <div className="rc-periodo">
            <Select aria-label="Período" value={preset} onChange={(e) => setPreset(e.target.value as PresetPeriodo)} options={PRESETS_PERIODO} />
            {preset === "custom" && (
              <>
                <label className="pg-filtro-data">De<input type="date" value={datas.startDate} onChange={(e) => setDatas((d) => ({ ...d, startDate: e.target.value }))} /></label>
                <label className="pg-filtro-data">Até<input type="date" value={datas.endDate} onChange={(e) => setDatas((d) => ({ ...d, endDate: e.target.value }))} /></label>
              </>
            )}
          </div>
        )}
        <div className="pg-atalhos" role="group" aria-label="Plataforma">
          <button type="button" className="pg-chip" aria-pressed={origem === "all"} onClick={() => setOrigem("all")}>Todas</button>
          {ORIGENS.filter((o) => porOrigem[o] > 0 || origem === o).map((o) => (
            <button key={o} type="button" className="pg-chip" aria-pressed={origem === o} onClick={() => setOrigem(origem === o ? "all" : o)}>
              {ORIGEM_ROTULO[o]} <span className="rc-chip-qtd">{porOrigem[o]}</span>
            </button>
          ))}
          {foco && vista === "pendentes" && (
            <button type="button" className="pg-chip" aria-pressed onClick={() => setFoco(null)} aria-label={`Remover filtro ${ROTULO_FOCO[foco]}`}>{ROTULO_FOCO[foco]} <X size={11} aria-hidden="true" /></button>
          )}
          {diaFoco && vista === "pendentes" && (
            <button type="button" className="pg-chip" aria-pressed onClick={() => setDiaFoco(null)} aria-label={`Remover filtro do dia ${formatDate(diaFoco)}`}>Dia {formatDate(diaFoco)} <X size={11} aria-hidden="true" /></button>
          )}
        </div>
      </div>

      <div className="pg-resultado" aria-live="polite">
        {podeReceber && vista === "pendentes" && selecionaveis.length > 0 && !carregando && (
          <input
            type="checkbox"
            className="pg-check"
            checked={selecionaveis.every((c) => selecionados.has(c.id))}
            ref={(el) => { if (el) el.indeterminate = selecionaveis.some((c) => selecionados.has(c.id)) && !selecionaveis.every((c) => selecionados.has(c.id)); }}
            onChange={() => alternarGrupo(selecionaveis.map((c) => c.id), !selecionaveis.every((c) => selecionados.has(c.id)))}
            aria-label={`Selecionar todas as ${selecionaveis.length} contas a receber`}
          />
        )}
        <span className="pg-resultado-qtd">{carregando ? "Carregando…" : `${exibidas.length} ${exibidas.length === 1 ? "conta" : "contas"}`}</span>
        {!carregando && exibidas.length > 0 && <strong className="pg-num"><Money value={totalExibido} /></strong>}
        {!carregando && exibidas.length > 0 && <span className="pg-resultado-qtd">{vista === "pendentes" ? "a receber" : vista === "recebidas" ? "recebidos" : ""}</span>}
        <span className="pg-resultado-periodo">{periodoTexto}</span>
      </div>

      {!carregando && !erro && truncado && (
        <Alert tone="warning" role="alert">A lista passou de {LIMITE_DA_LISTA} contas e foi cortada: escolha um período menor.</Alert>
      )}

      {carregando && !resumo ? (
        <div className="pg-carregando" role="status" aria-label="Carregando contas a receber">
          {[0, 1, 2, 3].map((i) => <div key={i} className="pg-esqueleto" />)}
        </div>
      ) : erro ? (
        <div className="pg-erro" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div><strong>Não foi possível carregar as contas a receber.</strong><p>{erro}</p></div>
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} />} onClick={() => void recarregar()}>Tentar de novo</Button>
        </div>
      ) : grupos.length === 0 ? (
        <EmptyState
          title={busca ? `Nenhuma conta encontrada para "${busca}".` : vista === "pendentes" ? "Tudo recebido: nada a receber agora." : "Nenhuma conta neste período."}
          description={temFiltro ? "Ajuste a busca ou limpe os filtros." : "Repasses do iFood, 99 Food e Keeta, eventos e a coleta de óleo aparecem aqui."}
        />
      ) : (
        <ListaContas
          grupos={grupos}
          hoje={hoje}
          rotuloTotal={vista === "pendentes" ? "Falta receber" : "Total do mês"}
          rotuloData={vista === "pendentes" ? "Previsto" : vista === "recebidas" ? "Recebido em" : "Data"}
          podeReceber={podeReceber}
          podeDesfazer={podeDesfazer}
          selecionados={selecionados}
          onAlternar={alternar}
          onAlternarGrupo={alternarGrupo}
          onReceberGrupo={(ids) => setAcao({ tipo: "lote", ids })}
          onVer={(c) => setDetalheId(c.id)}
          onReceber={(c) => setAcao({ tipo: "receber", conta: c })}
          onCancelar={(c) => setAcao({ tipo: "cancelar", conta: c })}
          onEstornar={(c) => setDetalheId(c.id)}
        />
      )}

      {escolhidas.length > 0 && (
        <div className="pg-selecao" role="region" aria-label="Contas selecionadas">
          <span className="pg-selecao-info"><strong>{escolhidas.length}</strong> selecionada(s) · <strong className="pg-num"><Money value={totalEscolhido} /></strong></span>
          <span className="pg-selecao-acoes">
            <Button variant="secondary" size="sm" onClick={() => setSelecionados(new Set())}>Limpar seleção</Button>
            <Button size="sm" leadingIcon={<CheckCircle2 size={14} />} onClick={() => setAcao({ tipo: "lote", ids: escolhidas.map((c) => c.id) })}>Receber selecionadas</Button>
          </span>
        </div>
      )}

      {detalheId && (
        <DetalheConta
          id={detalheId}
          versao={versao}
          podeReceber={podeReceber}
          podeDesfazer={podeDesfazer}
          onFechar={() => setDetalheId(null)}
          onReceber={(c: ReceivableDetail) => setAcao({ tipo: "receber", conta: c })}
          onCancelar={(c: ReceivableDetail) => setAcao({ tipo: "cancelar", conta: c })}
          onEstornar={(c, recebimento) => setAcao({ tipo: "estornar", conta: c, recebimento })}
        />
      )}

      {acao?.tipo === "receber" && <ModalReceber conta={acao.conta} hoje={hoje} onFechar={() => setAcao(null)} onConfirmar={(v) => receber(acao.conta, v)} />}
      {acao?.tipo === "nova" && <ModalNova hoje={hoje} onFechar={() => setAcao(null)} onConfirmar={lancar} />}
      {acao?.tipo === "cancelar" && (
        <ModalMotivo
          eyebrow="Cancelar conta a receber"
          titulo={tituloDaConta(acao.conta.description)}
          contexto={contexto(acao.conta)}
          nota="A conta deixa de contar como a receber. O motivo fica registrado na auditoria. Só é possível cancelar conta sem recebimento."
          rotuloMotivo="Motivo do cancelamento"
          placeholder="Ex.: evento desmarcado, lançado em duplicidade…"
          rotuloConfirmar="Cancelar conta"
          rotuloEnviando="Cancelando…"
          icone={<Ban size={16} />}
          onFechar={() => setAcao(null)}
          onConfirmar={(motivo) => cancelar(acao.conta, motivo)}
        />
      )}
      {acao?.tipo === "estornar" && (
        <ModalMotivo
          eyebrow="Estorno de recebimento"
          titulo={tituloDaConta(acao.conta.description)}
          contexto={
            <>
              <div><span>Valor recebido</span><strong><Money value={acao.recebimento.amount} /></strong></div>
              <div><span>Data</span><strong>{formatDate(acao.recebimento.receivedDate)}</strong></div>
            </>
          }
          nota="O recebimento é desfeito e a conta volta a ter esse valor a receber. O lançamento continua no histórico, marcado como estornado."
          rotuloMotivo="Motivo do estorno"
          placeholder="Ex.: valor digitado errado, o dinheiro não caiu…"
          rotuloConfirmar="Confirmar estorno"
          rotuloEnviando="Estornando…"
          icone={<RotateCcw size={16} />}
          onFechar={() => setAcao(null)}
          onConfirmar={(motivo) => estornar(acao.conta, acao.recebimento, motivo)}
        />
      )}
      {acao?.tipo === "lote" && (
        <ModalLote
          contas={pendentes.filter((c) => acao.ids.includes(c.id))}
          hoje={hoje}
          onFechar={() => setAcao(null)}
          onConcluir={({ feitas, falhas }) => {
            setSelecionados(new Set());
            setVersao((v) => v + 1);
            void recarregar();
            if (falhas.length === 0) {
              setAcao(null);
              setNotice({ tone: "success", message: `${feitas} ${feitas === 1 ? "recebimento registrado" : "recebimentos registrados"}.` });
            }
          }}
        />
      )}
    </section>
  );
}
