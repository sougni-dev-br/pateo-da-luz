import { Download, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  cancelWasteEntry,
  createWasteEntry,
  getWasteAnalysis,
  getWasteEntries,
  saveDishProductConversion,
  uploadWastePhoto,
  type WasteAnalysis,
  type WasteEntry,
  type WasteInput,
  type WasteProductHit,
} from "../../api/client";
import { Notice, useNotice } from "../../components/Notice";
import { Dialog } from "../../components/ui/Dialog";
import { useSession } from "../../context/SessionContext";
import { Button, EmptyState, Money, Tabs, TextField, Textarea } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { lerNumero } from "../../lib/fichaTecnica";
import { hasPermission } from "../../lib/permissions";
import { csvDosLancamentos, lerPeriodo, type Leitura } from "./analise";
import { formatarQuantidade } from "./quantidade";
import type { ModoDoItem } from "./BuscaProdutoDesperdicio";
import { ConfiguracaoDoAlerta } from "./ConfiguracaoDoAlerta";
import { VisualizadorDeFoto } from "./FotoDoDesperdicio";
import { FormularioDeDesperdicio } from "./FormularioDeDesperdicio";
import { IndicadoresDoPeriodo } from "./IndicadoresDoPeriodo";
import { LeituraDoPeriodo } from "./LeituraDoPeriodo";
import { ListaDeDesperdicio } from "./ListaDeDesperdicio";
import { PeriodoDoDesperdicio } from "./PeriodoDoDesperdicio";
import { QualidadeDoRegistro } from "./QualidadeDoRegistro";
import { QuebraDoPeriodo } from "./QuebraDoPeriodo";
import { TendenciaDoPeriodo } from "./TendenciaDoPeriodo";
import { SEM_FILTRO, filtrarLancamentos, temFiltro, type FiltroDaLista } from "./filtros";
import { reduzirFoto } from "./foto";
import { PERIODO_PADRAO_DIAS, somarDiasIso } from "./motivos";
import "./desperdicio.css";
import "./analise.css";

// Desperdício. É uma leitura do CMV (o item já saiu do estoque e entrou no consumo): aqui não se baixa
// estoque nem se lança despesa — só se registra o que foi perdido e por quê, e se lê o que fazer a respeito.

const AVISO_DURA_MS = 12_000;

type Aba = "lancar" | "analise";

async function enviarFoto(id: string, arquivo: File): Promise<string | null> {
  try {
    await uploadWastePhoto(id, await reduzirFoto(arquivo));
    return null;
  } catch (falha) {
    return falha instanceof Error ? falha.message : "erro desconhecido.";
  }
}

/**
 * O peso de 1 unidade informado no lançamento vira conversão do produto quando quem lança é da gestão
 * (assim o item passa a aceitar g/ml para todos). Para os demais, vale só para aquele lançamento.
 * Gravar é depois de registrar e nunca derruba o desperdício: o texto devolvido vai no aviso.
 */
async function guardarConversaoInformada(dados: WasteInput, podeGravar: boolean): Promise<string> {
  const soNesteLancamento = " O peso informado valeu só para este lançamento: peça à gestão para cadastrá-lo no produto.";
  if (!dados.perUnit || !dados.productId || !podeGravar) return soNesteLancamento;
  try {
    await saveDishProductConversion(dados.productId, { unit: dados.perUnit.unit, amount: lerNumero(dados.perUnit.quantity) });
    return " Conversão salva no produto: o item passa a aceitar essa medida para todos.";
  } catch {
    return soNesteLancamento;
  }
}

function baixarCsv(conteudo: string, nome: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function Desperdicio() {
  const { user } = useSession();
  const { notice, setNotice } = useNotice(AVISO_DURA_MS);
  const [parametros, setParametros] = useSearchParams();
  const podeLancar = hasPermission(user, "inventory-waste", "create");
  const podeCancelar = hasPermission(user, "inventory-waste", "delete");
  const podeConfigurar = hasPermission(user, "inventory-waste", "admin");
  const veCusto = hasPermission(user, "inventory-costs", "view");
  // Gravar "1 UN = 500 g" no produto muda também compras e contagem: é da gestão (mesma regra da ficha técnica).
  const podeGravarConversao = hasPermission(user, "dishes", "edit");

  // Quem lança sem ver custos (estoquista) abre direto no lançamento; quem lê valores abre na análise.
  const pedida = parametros.get("aba");
  const aba: Aba = podeLancar && (pedida === "lancar" || (pedida !== "analise" && !veCusto)) ? "lancar" : "analise";
  const irParaAba = useCallback((nova: Aba) => setParametros((atual) => { const p = new URLSearchParams(atual); p.set("aba", nova); return p; }, { replace: true }), [setParametros]);

  const [de, setDe] = useState(() => somarDiasIso(hojeLocalIso(), -(PERIODO_PADRAO_DIAS - 1)));
  const [ate, setAte] = useState(() => hojeLocalIso());
  const [carregando, setCarregando] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [itens, setItens] = useState<WasteEntry[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [analise, setAnalise] = useState<WasteAnalysis | null>(null);
  const [filtro, setFiltro] = useState<FiltroDaLista>(SEM_FILTRO);
  const [deHoje, setDeHoje] = useState<WasteEntry[]>([]);

  const [vendoFoto, setVendoFoto] = useState<WasteEntry | null>(null);
  const [anexandoEm, setAnexandoEm] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<WasteEntry | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [cancelandoAgora, setCancelandoAgora] = useState(false);
  const [erroDoCancelamento, setErroDoCancelamento] = useState<string | null>(null);
  const tituloDaLista = useRef<HTMLHeadingElement>(null);

  // Cada carga recebe um número; só a última pode escrever na tela. Sem isso, digitar a data (o campo
  // dispara a cada pedaço) deixa uma resposta antiga sobrescrever a nova e a tela mistura períodos.
  const cargaAtual = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++cargaAtual.current;
    // Data apagada: o servidor assumiria os últimos 30 dias e a tela mostraria outro período. Sai tudo da tela,
    // e o estado de "carregando" não pode ficar preso numa carga que acabou de ser invalidada.
    if (!de || !ate) {
      setItens([]);
      setAnalise(null);
      setErroDeCarga(null);
      setCarregando(false);
      return;
    }
    setCarregando(true);
    try {
      const [lista, leitura] = await Promise.all([getWasteEntries({ from: de, to: ate }), getWasteAnalysis({ from: de, to: ate })]);
      if (minha !== cargaAtual.current) return;
      setItens(lista.items ?? []);
      setTruncado(Boolean(lista.truncated));
      setAnalise(leitura);
      setErroDeCarga(null);
    } catch (falha) {
      if (minha !== cargaAtual.current) return;
      // Dados do período anterior com as datas novas na tela seriam números errados: sai tudo e o erro fica à vista.
      setItens([]);
      setAnalise(null);
      setErroDeCarga(falha instanceof Error ? falha.message : "Não foi possível carregar o desperdício.");
    } finally {
      if (minha === cargaAtual.current) setCarregando(false);
    }
  }, [de, ate]);

  const carregarHoje = useCallback(async () => {
    const hoje = hojeLocalIso();
    try {
      setDeHoje((await getWasteEntries({ from: hoje, to: hoje })).items ?? []);
    } catch {
      // O que foi lançado hoje é só conferência: se não carregar, o lançamento em si segue funcionando.
      setDeHoje([]);
    }
  }, []);

  useEffect(() => {
    void carregar();
    // Resposta que ainda voa quando a tela sai não escreve em componente desmontado.
    return () => { cargaAtual.current += 1; };
  }, [carregar]);

  useEffect(() => { void carregarHoje(); }, [carregarHoje]);

  // Período novo, recortes antigos: o filtro de um item que nem está no período deixaria a lista vazia sem explicação.
  const mudarPeriodo = useCallback((novoDe: string, novoAte: string) => {
    setDe(novoDe);
    setAte(novoAte);
    setFiltro(SEM_FILTRO);
  }, []);

  async function registrar(dados: WasteInput, escolhido: WasteProductHit, _modo: ModoDoItem, foto: File | null): Promise<boolean> {
    try {
      const criada = await createWasteEntry(dados);
      // A foto é opcional e vem depois: se falhar, o desperdício já está registrado e a pessoa é avisada.
      const falhaDaFoto = foto ? await enviarFoto(criada.id, foto) : null;
      const semCusto = criada.hasCost ? "" : " Sem custo conhecido: não entra no valor nem no aviso do dia.";
      const conversao = dados.perUnit ? await guardarConversaoInformada(dados, podeGravarConversao) : "";
      setNotice(falhaDaFoto
        ? { tone: "error", message: `Desperdício de ${escolhido.name} registrado, mas a foto não foi enviada: ${falhaDaFoto} Use "Anexar foto" na lista.${semCusto}${conversao}` }
        : { tone: criada.hasCost ? "success" : "warning", message: `Desperdício de ${escolhido.name} registrado.${semCusto}${conversao}` });
      void carregarHoje();
      // Lançamento de dia fora do período mostrado não apareceria na lista: o período se abre para incluí-lo.
      if (dados.occurredOn < de) { setDe(dados.occurredOn); setFiltro(SEM_FILTRO); }
      else if (dados.occurredOn > ate) { setAte(dados.occurredOn); setFiltro(SEM_FILTRO); }
      else void carregar();
      return true;
    } catch (falha) {
      setNotice({ tone: "error", message: falha instanceof Error ? falha.message : "Não foi possível registrar." });
      return false;
    }
  }

  async function anexarFoto(item: WasteEntry, arquivo: File) {
    setAnexandoEm(item.id);
    const falha = await enviarFoto(item.id, arquivo);
    setAnexandoEm(null);
    setNotice(falha ? { tone: "error", message: `A foto não foi enviada: ${falha}` } : { tone: "success", message: "Foto anexada." });
    if (!falha) { void carregar(); void carregarHoje(); }
  }

  function fecharCancelamento() {
    setCancelando(null);
    setMotivoCancelamento("");
    setErroDoCancelamento(null);
  }

  async function confirmarCancelamento() {
    if (!cancelando) return;
    setCancelandoAgora(true);
    setErroDoCancelamento(null);
    try {
      await cancelWasteEntry(cancelando.id, motivoCancelamento);
      setNotice({ tone: "success", message: "Lançamento cancelado." });
      fecharCancelamento();
      void carregar();
      void carregarHoje();
    } catch (falha) {
      // O aviso da página fica atrás do diálogo: o erro aparece dentro dele, onde a pessoa está olhando.
      setErroDoCancelamento(falha instanceof Error ? falha.message : "Não foi possível cancelar.");
      // Já cancelado por outra pessoa, ou sumiu: a lista que a pessoa vê está velha.
      if (falha instanceof Error && /já foi cancelado|não encontrado/i.test(falha.message)) { void carregar(); void carregarHoje(); }
    } finally {
      setCancelandoAgora(false);
    }
  }

  function filtrarPelaLeitura(leitura: Leitura) {
    if (!leitura.filtro) return;
    setFiltro(leitura.filtro.tipo === "motivo"
      ? { ...SEM_FILTRO, motivo: leitura.filtro.valor }
      : { ...SEM_FILTRO, item: { chave: leitura.filtro.valor, rotulo: leitura.filtro.rotulo } });
    // A lista fica abaixo: sem levar a pessoa até ela o clique parece não ter feito nada.
    window.requestAnimationFrame(() => {
      tituloDaLista.current?.scrollIntoView({ block: "start" });
      tituloDaLista.current?.focus({ preventScroll: true });
    });
  }

  const mudarFiltro = (parcial: Partial<FiltroDaLista>) => setFiltro((atual) => ({ ...atual, ...parcial }));

  const leituras = useMemo(() => (analise ? lerPeriodo(analise, veCusto) : []), [analise, veCusto]);
  const visiveis = useMemo(() => filtrarLancamentos(itens, filtro), [itens, filtro]);
  const ativos = itens.filter((item) => !item.cancelledAt);
  const vazio = Boolean(de && ate) && !carregando && !erroDeCarga && itens.length === 0;
  const totalDeHoje = deHoje.filter((i) => !i.cancelledAt);
  const valorDeHoje = totalDeHoje.reduce((s, i) => s + (typeof i.totalCost === "number" ? i.totalCost : 0), 0);

  const listaProps = {
    veCusto,
    usuarioId: user?.id ?? null,
    podeLancar,
    podeCancelar,
    anexandoEm,
    onAnexar: (item: WasteEntry, arquivo: File) => void anexarFoto(item, arquivo),
    onVerFoto: setVendoFoto,
    onCancelar: setCancelando,
  };

  return (
    <div className="page-content waste-page">
      <Notice notice={notice} />

      <header className="waste-head">
        <p className="waste-intro">
          {aba === "lancar"
            ? "Registre o que foi jogado fora e por quê. Isto não baixa estoque nem lança despesa: é só o registro da perda."
            : "O desperdício já está dentro do CMV. Aqui você vê quanto, por quê e onde a loja perde, e o que fazer a respeito."}
        </p>
        {podeLancar && (
          <Tabs
            aria-label="Desperdício"
            value={aba}
            onChange={(valor) => irParaAba(valor as Aba)}
            tabs={[{ value: "lancar", label: "Lançar" }, { value: "analise", label: "Análise" }]}
          />
        )}
      </header>

      {aba === "lancar" && podeLancar && (
        <>
          <FormularioDeDesperdicio onSalvar={registrar} />
          <section className="waste-report" aria-labelledby="waste-hoje-titulo">
            <div className="waste-section-head">
              <h2 id="waste-hoje-titulo">Lançado hoje</h2>
              {totalDeHoje.length > 0 && (
                <span className="waste-note">
                  {totalDeHoje.length} {totalDeHoje.length === 1 ? "lançamento" : "lançamentos"}
                  {veCusto && valorDeHoje > 0 && <> · <Money value={valorDeHoje} /></>}
                </span>
              )}
            </div>
            {deHoje.length === 0
              ? <p className="waste-note">Nada lançado hoje até agora.</p>
              : <ListaDeDesperdicio itens={deHoje} {...listaProps} />}
          </section>
        </>
      )}

      {aba === "analise" && (
        <section className="waste-report" aria-labelledby="waste-periodo-titulo" aria-busy={carregando}>
          <div className="waste-section-head">
            <h2 id="waste-periodo-titulo">Desperdício no período</h2>
            {podeLancar && <Button variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => irParaAba("lancar")}>Registrar desperdício</Button>}
          </div>
          <PeriodoDoDesperdicio de={de} ate={ate} carregando={carregando} onMudar={mudarPeriodo} onAtualizar={() => void carregar()} />

          {(!de || !ate) && <p className="waste-note" role="status">Informe as duas datas para ver o período.</p>}
          {carregando && !analise && !erroDeCarga && <p className="waste-note" role="status">Carregando…</p>}

          {erroDeCarga && (
            <div className="waste-load-error" role="alert">
              <strong>Não foi possível carregar o desperdício deste período.</strong>
              <span>{erroDeCarga}</span>
              <Button variant="secondary" onClick={() => void carregar()}>Tentar de novo</Button>
            </div>
          )}

          {analise && analise.total.lancamentos > 0 && (
            <>
              <IndicadoresDoPeriodo analise={analise} veCusto={veCusto} />
              <LeituraDoPeriodo leituras={leituras} onFiltrar={filtrarPelaLeitura} />
              <TendenciaDoPeriodo analise={analise} veCusto={veCusto} />
              <div className="waste-two">
                <QuebraDoPeriodo analise={analise} veCusto={veCusto} filtro={filtro} onFiltrar={mudarFiltro} />
                <QualidadeDoRegistro analise={analise} veCusto={veCusto} />
              </div>
            </>
          )}

          {vazio && (
            <EmptyState
              title="Nenhum desperdício no período"
              description={podeLancar ? "Quando alguém registrar uma perda, ela aparece aqui. Se a loja perdeu algo e não foi lançado, os números ficam abaixo do real." : "Quando alguém registrar uma perda, ela aparece aqui."}
            />
          )}

          {itens.length > 0 && (
            <div className="waste-lancamentos">
              <div className="waste-section-head">
                <h3 id="waste-lancamentos-titulo" ref={tituloDaLista} tabIndex={-1}>Lançamentos</h3>
                <Button
                  variant="secondary"
                  leadingIcon={<Download size={14} />}
                  disabled={visiveis.length === 0}
                  onClick={() => baixarCsv(csvDosLancamentos(visiveis, veCusto), `desperdicio-${de}-a-${ate}.csv`)}
                >
                  Baixar planilha
                </Button>
              </div>
              <div className="waste-listbar">
                <TextField label="Buscar na lista" type="search" value={filtro.busca} onChange={(event) => mudarFiltro({ busca: event.target.value })} placeholder="Item, código, setor, observação" autoComplete="off" />
                {temFiltro(filtro) && (
                  <div className="waste-active-filters" role="group" aria-label="Recortes aplicados">
                    {filtro.motivo && <FiltroAtivo rotulo={`Motivo: ${itens.find((i) => i.reason === filtro.motivo)?.reasonLabel ?? filtro.motivo}`} onRemover={() => mudarFiltro({ motivo: null })} />}
                    {filtro.setor && <FiltroAtivo rotulo={`Setor: ${filtro.setor}`} onRemover={() => mudarFiltro({ setor: null })} />}
                    {filtro.item && <FiltroAtivo rotulo={`Item: ${filtro.item.rotulo}`} onRemover={() => mudarFiltro({ item: null })} />}
                    <button type="button" className="waste-link" onClick={() => setFiltro(SEM_FILTRO)}>Limpar tudo</button>
                  </div>
                )}
              </div>
              {truncado && <p className="waste-note">Mostrando os 500 lançamentos mais recentes; reduza o período para ver os demais. Os totais acima consideram todos.</p>}
              {temFiltro(filtro) && <p className="waste-note" role="status">{visiveis.length} de {itens.length} lançamentos.</p>}
              {visiveis.length === 0
                ? <p className="waste-note">Nenhum lançamento com esse recorte.</p>
                : <ListaDeDesperdicio itens={visiveis} {...listaProps} />}
              {ativos.length !== itens.length && <p className="waste-note">Lançamentos cancelados ficam na lista para auditoria e não entram nos totais.</p>}
            </div>
          )}
        </section>
      )}

      {/* Configuração é de uso raro: fica depois do relatório, que é o que o admin abre a tela para ler. */}
      {aba === "analise" && podeConfigurar && <ConfiguracaoDoAlerta />}

      {vendoFoto && <VisualizadorDeFoto lancamentoId={vendoFoto.id} titulo={`${vendoFoto.productName} · ${vendoFoto.reasonLabel}`} onFechar={() => setVendoFoto(null)} />}

      <Dialog
        open={cancelando !== null}
        onOpenChange={(aberto) => { if (!aberto && !cancelandoAgora) fecharCancelamento(); }}
        title="Cancelar lançamento"
        description={cancelando ? `${cancelando.productName} · ${cancelando.enteredQuantity != null && cancelando.enteredUnit ? `${formatarQuantidade(cancelando.enteredQuantity)} ${cancelando.enteredUnit}` : `${formatarQuantidade(cancelando.quantity)} ${cancelando.unit ?? ""}`} · ${cancelando.reasonLabel}` : undefined}
        size="sm"
      >
        <Textarea
          label="Motivo do cancelamento"
          hint="Mínimo de 3 caracteres. Fica registrado na auditoria."
          rows={2}
          maxLength={300}
          autoFocus
          value={motivoCancelamento}
          onChange={(event) => setMotivoCancelamento(event.target.value)}
        />
        {erroDoCancelamento && <p className="waste-error" role="alert">{erroDoCancelamento}</p>}
        <div className="waste-dialog-actions">
          <Button variant="secondary" disabled={cancelandoAgora} onClick={fecharCancelamento}>Voltar</Button>
          <Button variant="danger" disabled={cancelandoAgora || motivoCancelamento.trim().length < 3} onClick={() => void confirmarCancelamento()}>
            {cancelandoAgora ? "Cancelando…" : "Cancelar lançamento"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function FiltroAtivo({ rotulo, onRemover }: { rotulo: string; onRemover: () => void }) {
  return (
    <span className="waste-filter-chip">
      {rotulo}
      <button type="button" aria-label={`Remover recorte ${rotulo}`} onClick={onRemover}><X size={13} aria-hidden /></button>
    </span>
  );
}
