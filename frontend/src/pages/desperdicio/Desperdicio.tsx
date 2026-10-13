import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelWasteEntry,
  createWasteEntry,
  getWasteEntries,
  getWasteSummary,
  uploadWastePhoto,
  type WasteEntry,
  type WasteInput,
  type WasteProductHit,
  type WasteSummary,
} from "../../api/client";
import { Notice, useNotice } from "../../components/Notice";
import { Dialog } from "../../components/ui/Dialog";
import { useSession } from "../../context/SessionContext";
import { Button, EmptyState, TextField, Textarea } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { hasPermission } from "../../lib/permissions";
import { formatNumber } from "../../utils/format";
import type { ModoDoItem } from "./BuscaProdutoDesperdicio";
import { ConfiguracaoDoAlerta } from "./ConfiguracaoDoAlerta";
import { VisualizadorDeFoto } from "./FotoDoDesperdicio";
import { FormularioDeDesperdicio } from "./FormularioDeDesperdicio";
import { ListaDeDesperdicio } from "./ListaDeDesperdicio";
import { ResumoDoPeriodo } from "./ResumoDoPeriodo";
import { reduzirFoto } from "./foto";
import { PERIODO_PADRAO_DIAS, somarDiasIso } from "./motivos";
import "./desperdicio.css";

// Desperdício. É uma leitura do CMV (o item já saiu do estoque e entrou no consumo): aqui não se baixa
// estoque nem se lança despesa — só se registra o que foi perdido e por quê.

const AVISO_DURA_MS = 12_000;

async function enviarFoto(id: string, arquivo: File): Promise<string | null> {
  try {
    await uploadWastePhoto(id, await reduzirFoto(arquivo));
    return null;
  } catch (falha) {
    return falha instanceof Error ? falha.message : "erro desconhecido.";
  }
}

export function Desperdicio() {
  const { user } = useSession();
  const { notice, setNotice } = useNotice(AVISO_DURA_MS);
  const podeLancar = hasPermission(user, "inventory-waste", "create");
  const podeCancelar = hasPermission(user, "inventory-waste", "delete");
  const podeConfigurar = hasPermission(user, "inventory-waste", "admin");
  const veCusto = hasPermission(user, "inventory-costs", "view");

  const [de, setDe] = useState(() => somarDiasIso(hojeLocalIso(), -(PERIODO_PADRAO_DIAS - 1)));
  const [ate, setAte] = useState(() => hojeLocalIso());
  const [carregando, setCarregando] = useState(true);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [itens, setItens] = useState<WasteEntry[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [resumo, setResumo] = useState<WasteSummary | null>(null);

  const [vendoFoto, setVendoFoto] = useState<WasteEntry | null>(null);
  const [anexandoEm, setAnexandoEm] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState<WasteEntry | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState("");
  const [cancelandoAgora, setCancelandoAgora] = useState(false);
  const [erroDoCancelamento, setErroDoCancelamento] = useState<string | null>(null);

  // Cada carga recebe um número; só a última pode escrever na tela. Sem isso, digitar a data (o campo
  // dispara a cada pedaço) deixa uma resposta antiga sobrescrever a nova e a tela mistura períodos.
  const cargaAtual = useRef(0);

  const carregar = useCallback(async () => {
    // Data apagada: o servidor assumiria os últimos 30 dias e a tela mostraria outro período.
    if (!de || !ate) return;
    const minha = ++cargaAtual.current;
    setCarregando(true);
    try {
      const [lista, soma] = await Promise.all([getWasteEntries({ from: de, to: ate }), getWasteSummary({ from: de, to: ate })]);
      if (minha !== cargaAtual.current) return;
      setItens(lista.items ?? []);
      setTruncado(Boolean(lista.truncated));
      setResumo(soma);
      setErroDeCarga(null);
    } catch (falha) {
      if (minha !== cargaAtual.current) return;
      // Dados do período anterior com as datas novas na tela seriam números errados: sai tudo e o erro fica à vista.
      setItens([]);
      setResumo(null);
      setErroDeCarga(falha instanceof Error ? falha.message : "Não foi possível carregar o desperdício.");
    } finally {
      if (minha === cargaAtual.current) setCarregando(false);
    }
  }, [de, ate]);

  useEffect(() => {
    void carregar();
    // Resposta que ainda voa quando a tela sai não escreve em componente desmontado.
    return () => { cargaAtual.current += 1; };
  }, [carregar]);

  async function registrar(dados: WasteInput, escolhido: WasteProductHit, _modo: ModoDoItem, foto: File | null): Promise<boolean> {
    try {
      const criada = await createWasteEntry(dados);
      // A foto é opcional e vem depois: se falhar, o desperdício já está registrado e a pessoa é avisada.
      const falhaDaFoto = foto ? await enviarFoto(criada.id, foto) : null;
      const semCusto = criada.hasCost ? "" : " Sem custo conhecido: não entra no valor nem no aviso do dia.";
      setNotice(falhaDaFoto
        ? { tone: "error", message: `Desperdício de ${escolhido.name} registrado, mas a foto não foi enviada: ${falhaDaFoto} Use "Anexar foto" na lista.${semCusto}` }
        : { tone: criada.hasCost ? "success" : "warning", message: `Desperdício de ${escolhido.name} registrado.${semCusto}` });
      // Lançamento de dia fora do período mostrado não apareceria na lista: o período se abre para incluí-lo.
      if (dados.occurredOn < de) setDe(dados.occurredOn);
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
    if (!falha) void carregar();
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
    } catch (falha) {
      // O aviso da página fica atrás do diálogo: o erro aparece dentro dele, onde a pessoa está olhando.
      setErroDoCancelamento(falha instanceof Error ? falha.message : "Não foi possível cancelar.");
      // Já cancelado por outra pessoa, ou sumiu: a lista que a pessoa vê está velha.
      if (falha instanceof Error && /já foi cancelado|não encontrado/i.test(falha.message)) void carregar();
    } finally {
      setCancelandoAgora(false);
    }
  }

  const ativos = itens.filter((item) => !item.cancelledAt);
  const vazio = !carregando && !erroDeCarga && itens.length === 0;

  return (
    <div className="page-content waste-page">
      <Notice notice={notice} />

      <p className="waste-intro">Registre o que foi jogado fora e por quê. Isto não baixa estoque nem lança despesa: é só o registro da perda.</p>

      {podeLancar && <FormularioDeDesperdicio onSalvar={registrar} />}

      <section className="waste-report" aria-labelledby="waste-periodo-titulo" aria-busy={carregando}>
        <h2 id="waste-periodo-titulo">Desperdício no período</h2>
        <div className="waste-filters">
          <TextField label="De" type="date" value={de} max={ate} onChange={(event) => setDe(event.target.value)} />
          <TextField label="Até" type="date" value={ate} min={de} max={hojeLocalIso()} onChange={(event) => setAte(event.target.value)} />
          <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} disabled={carregando} onClick={() => void carregar()}>Atualizar</Button>
        </div>

        {carregando && itens.length === 0 && !erroDeCarga && <p className="waste-note" role="status">Carregando…</p>}

        {erroDeCarga && (
          <div className="waste-load-error" role="alert">
            <strong>Não foi possível carregar o desperdício deste período.</strong>
            <span>{erroDeCarga}</span>
            <Button variant="secondary" onClick={() => void carregar()}>Tentar de novo</Button>
          </div>
        )}

        {resumo?.total && resumo.total.lancamentos > 0 && <ResumoDoPeriodo resumo={resumo} veCusto={veCusto} />}

        {vazio && <EmptyState title="Nenhum desperdício no período" description="Quando alguém registrar uma perda, ela aparece aqui." />}

        {itens.length > 0 && (
          <>
            {truncado && <p className="waste-note">Mostrando os 500 lançamentos mais recentes; reduza o período para ver os demais.</p>}
            <ListaDeDesperdicio
              itens={itens}
              veCusto={veCusto}
              usuarioId={user?.id ?? null}
              podeLancar={podeLancar}
              podeCancelar={podeCancelar}
              anexandoEm={anexandoEm}
              onAnexar={(item, arquivo) => void anexarFoto(item, arquivo)}
              onVerFoto={setVendoFoto}
              onCancelar={setCancelando}
            />
            {ativos.length !== itens.length && <p className="waste-note">Lançamentos cancelados ficam na lista para auditoria e não entram nos totais.</p>}
          </>
        )}
      </section>

      {/* Configuração é de uso raro: fica depois do relatório, que é o que o admin abre a tela para ler. */}
      {podeConfigurar && <ConfiguracaoDoAlerta />}

      {vendoFoto && <VisualizadorDeFoto lancamentoId={vendoFoto.id} titulo={`${vendoFoto.productName} · ${vendoFoto.reasonLabel}`} onFechar={() => setVendoFoto(null)} />}

      <Dialog
        open={cancelando !== null}
        onOpenChange={(aberto) => { if (!aberto && !cancelandoAgora) fecharCancelamento(); }}
        title="Cancelar lançamento"
        description={cancelando ? `${cancelando.productName} · ${formatNumber(cancelando.quantity)} ${cancelando.unit ?? ""} · ${cancelando.reasonLabel}` : undefined}
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
