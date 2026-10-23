import "./coleta-oleo/coleta-oleo.css";
import { Ban, CalendarDays, Droplets, ExternalLink, Hourglass, Pencil, Plus, RefreshCw, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cancelOilCollection,
  createOilCollection,
  getOilCollections,
  OilCollection,
  OilCollectionInput,
  OilCollectionList,
  OilCollectionStatus,
  updateOilCollection
} from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Dialog } from "../components/ui/Dialog";
import { useSession } from "../context/SessionContext";
import { Alert, Button, EmptyState, FormGrid, KpiCard, Money, PanelEyebrow, RowMenu, Select, StatusBadge, Table, TextField, Textarea } from "../design-system";
import type { RowMenuItem } from "../design-system";
import { hojeLocalIso } from "../lib/datas";
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";
import { diasEntre, haQuantoTempo, precoPorLitro, situacaoDoPix } from "./coleta-oleo/regras";

// Coleta de óleo de fritura: cada visita do coletor deixa um certificado (CDF) com o valor em dinheiro,
// que ele paga por PIX durante o dia. A tela guarda os dados do certificado e deixa conferir o PIX.

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeDoMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(0, 4)}`;
const litros = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L`;
const numeroDoCertificado = (c: OilCollection) => c.certificateNumber?.split("#")[0] || "—";

const formularioVazio = (): OilCollectionInput => ({ collectionDate: hojeLocalIso(), collectorName: "Retióleo", certificateNumber: "", volumeLiters: "", amount: "", notes: "" });

const paraFormulario = (c: OilCollection): OilCollectionInput => ({
  collectionDate: c.collectionDate,
  collectorName: c.collectorName,
  certificateNumber: numeroDoCertificado(c) === "—" ? "" : numeroDoCertificado(c),
  volumeLiters: String(c.volumeLiters).replace(".", ","),
  amount: c.amount.toFixed(2).replace(".", ","),
  notes: c.notes ?? ""
});

type Etapa = { tipo: "form"; id: string | null; values: OilCollectionInput; baixada: boolean } | { tipo: "cancelar"; coleta: OilCollection; motivo: string };

const ROTA_CONTAS_A_RECEBER = "/financeiro/contas-a-receber";
const foiBaixada = (c: OilCollection) => c.status === "RECEIVED" || c.status === "PARTIAL";

export function ColetaOleo() {
  const { notice, setNotice } = useNotice();
  const { user } = useSession();
  const canCreate = hasPermission(user, "oil-collections", "create");
  const canEdit = hasPermission(user, "oil-collections", "edit");
  const canCancel = hasPermission(user, "oil-collections", "delete");
  const canSettle = hasPermission(user, "receivables", "edit");
  const navigate = useNavigate();

  const hoje = hojeLocalIso();
  const anoAtual = Number(hoje.slice(0, 4));
  const [year, setYear] = useState(anoAtual);
  const [filtro, setFiltro] = useState<"" | OilCollectionStatus>("");
  const [dados, setDados] = useState<OilCollectionList | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  // Erro de gravação aparece dentro do diálogo: o aviso da página fica atrás da cortina e ninguém o veria.
  const [erroDoDialogo, setErroDoDialogo] = useState<string | null>(null);

  async function carregar(silencioso = false) {
    if (!silencioso) setLoading(true);
    try {
      setDados(await getOilCollections(year));
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar as coletas." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void carregar(); }, [year]); // eslint-disable-line react-hooks/exhaustive-deps

  const itens = useMemo(() => (dados?.items ?? []).filter((i) => !filtro || i.status === filtro), [dados, filtro]);
  const resumo = dados?.summary;
  const emAberto = dados?.openPix;
  const anos = Array.from({ length: Math.max(1, anoAtual - (dados?.minYear ?? 2024) + 1) }, (_, i) => anoAtual - i);
  const diasDesdeAUltima = resumo?.lastCollectionDate ? diasEntre(resumo.lastCollectionDate, hoje) : null;

  function abrir(proxima: Etapa) {
    setErroDoDialogo(null);
    setEtapa(proxima);
  }

  async function executar(acao: () => Promise<unknown>, sucesso: string, noDialogo = false) {
    setErroDoDialogo(null);
    setBusy(true);
    try {
      await acao();
      setNotice({ tone: "success", message: sucesso });
      await carregar(true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Não foi possível concluir.";
      if (noDialogo) setErroDoDialogo(message); else setNotice({ tone: "error", message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmar() {
    if (!etapa) return;
    const ok =
      etapa.tipo === "form" ? await executar(() => (etapa.id ? updateOilCollection(etapa.id, etapa.values) : createOilCollection(etapa.values)), etapa.id ? "Coleta atualizada." : "Coleta registrada.", true)
      : await executar(() => cancelOilCollection(etapa.coleta.id, etapa.motivo), "Coleta cancelada.", true);
    if (ok) setEtapa(null);
  }

  const campo = (chave: keyof OilCollectionInput) => (e: { target: { value: string } }) =>
    setEtapa((atual) => (atual?.tipo === "form" ? { ...atual, values: { ...atual.values, [chave]: e.target.value } } : atual));

  const menuDaLinha = (c: OilCollection): RowMenuItem[] => [
    ...(canEdit ? [{ label: "Editar coleta", icon: <Pencil size={15} />, onClick: () => abrir({ tipo: "form", id: c.id, values: paraFormulario(c), baixada: foiBaixada(c) }) }] : []),
    ...(canSettle && foiBaixada(c) ? [{ label: "Abrir no Contas a Receber", icon: <ExternalLink size={15} />, onClick: () => navigate(ROTA_CONTAS_A_RECEBER) }] : []),
    ...(canCancel && !foiBaixada(c) ? [{ label: "Cancelar coleta", icon: <Ban size={15} />, tone: "danger" as const, onClick: () => abrir({ tipo: "cancelar", coleta: c, motivo: "" }) }] : [])
  ];

  const acoes = (c: OilCollection) => {
    if (c.status === "CANCELLED") return null;
    const itensDoMenu = menuDaLinha(c);
    return (
      <>
        {canSettle && !foiBaixada(c) && <Button size="sm" variant="secondary" leadingIcon={<ExternalLink size={14} />} onClick={() => navigate(ROTA_CONTAS_A_RECEBER)}>Dar baixa</Button>}
        {itensDoMenu.length > 0 && <RowMenu items={itensDoMenu} label={`Mais ações da coleta de ${formatDate(c.collectionDate)}`} />}
      </>
    );
  };

  const situacao = (c: OilCollection) => {
    const s = situacaoDoPix(c.status, c.collectionDate, hoje);
    return (
      <>
        <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
        {c.status === "RECEIVED" && c.receivedAt && <small className="coleta-nota">em {formatDate(c.receivedAt)}</small>}
        {c.status === "PARTIAL" && <small className="coleta-nota"><Money value={c.paidAmount} /> de <Money value={c.amount} /></small>}
        {c.status === "CANCELLED" && c.cancellationReason && <small className="coleta-nota">{c.cancellationReason}</small>}
      </>
    );
  };

  const precoPrevisto = etapa?.tipo === "form" ? precoPorLitro(etapa.values.volumeLiters, etapa.values.amount) : null;

  return (
    <div className="page-content coleta">
      <Notice notice={notice} />

      <p className="coleta-intro">
        Quando o coletor passar, registre aqui o <strong>certificado (CDF)</strong> que ele deixou: número, litros e o valor impresso nele.
        Cada coleta gera um título no <strong>Contas a Receber</strong>: quando o PIX chegar, dê a baixa lá e a situação se atualiza aqui. O valor <strong>não entra no faturamento</strong> do restaurante.
      </p>

      <section className="coleta-kpis" aria-label={`Resumo de ${year}`}>
        <KpiCard
          label="PIX a conferir"
          icon={<Hourglass size={18} />}
          tone={(emAberto?.count ?? 0) > 0 ? "warning" : "success"}
          value={emAberto?.count ?? 0}
          sub={emAberto && emAberto.count > 0 ? <>Faltam <Money value={emAberto.amount} /> (todos os anos)</> : "Tudo conferido"}
        />
        <KpiCard
          label={`Recebido em ${year}`}
          icon={<Wallet size={18} />}
          tone="success"
          moneyValue={resumo?.receivedAmount ?? 0}
          sub={`${resumo?.receivedCount ?? 0} ${resumo?.receivedCount === 1 ? "coleta paga" : "coletas pagas"}`}
        />
        <KpiCard
          label="Óleo coletado"
          icon={<Droplets size={18} />}
          tone="info"
          value={litros(resumo?.liters ?? 0)}
          sub={resumo?.pricePerLiter != null ? <><Money value={resumo.pricePerLiter} /> por litro, em média</> : "Sem coletas no ano"}
        />
        <KpiCard
          label="Última coleta"
          icon={<CalendarDays size={18} />}
          value={resumo?.lastCollectionDate ? formatDate(resumo.lastCollectionDate) : "—"}
          sub={diasDesdeAUltima !== null ? haQuantoTempo(diasDesdeAUltima) : "Nenhuma ainda"}
        />
      </section>

      <div className="coleta-barra">
        <Select aria-label="Ano" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={anos.map((a) => ({ value: String(a), label: String(a) }))} containerClassName="coleta-filtro" />
        <Select
          aria-label="Situação"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value as "" | OilCollectionStatus)}
          placeholder="Todas as situações"
          options={[{ value: "PENDING", label: "PIX pendente" }, { value: "PARTIAL", label: "Recebido em parte" }, { value: "RECEIVED", label: "PIX recebido" }, { value: "CANCELLED", label: "Canceladas" }]}
          containerClassName="coleta-filtro"
        />
        <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} disabled={loading} onClick={() => void carregar(true)}>Atualizar</Button>
        {canCreate && <Button className="coleta-nova" leadingIcon={<Plus size={16} />} onClick={() => abrir({ tipo: "form", id: null, values: formularioVazio(), baixada: false })}>Registrar coleta</Button>}
      </div>

      {loading && !dados ? (
        <div className="page-loading">Carregando coletas…</div>
      ) : itens.length === 0 ? (
        <EmptyState
          title={filtro ? "Nenhuma coleta com essa situação." : `Nenhuma coleta em ${year}.`}
          description={filtro ? "Troque o filtro de situação para ver as outras." : "Registre a primeira com os dados do certificado (CDF) que o coletor deixou."}
          action={!filtro && canCreate ? <Button leadingIcon={<Plus size={16} />} onClick={() => abrir({ tipo: "form", id: null, values: formularioVazio(), baixada: false })}>Registrar coleta</Button> : undefined}
        />
      ) : (
        <>
          <div className="sc-desktop-list">
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Th>Data</Table.Th>
                  <Table.Th>Certificado</Table.Th>
                  <Table.Th>Coletor</Table.Th>
                  <Table.Th align="right">Volume</Table.Th>
                  <Table.Th align="right">Valor</Table.Th>
                  <Table.Th>PIX</Table.Th>
                  <Table.Th actions>Ações</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {itens.map((c) => (
                  <Table.Row key={c.id}>
                    <Table.Td>{formatDate(c.collectionDate)}</Table.Td>
                    <Table.Td>{numeroDoCertificado(c)}</Table.Td>
                    <Table.Td>{c.collectorName}</Table.Td>
                    <Table.Td align="right">{litros(c.volumeLiters)}</Table.Td>
                    <Table.Td align="right" style={{ fontWeight: 600 }}><Money value={c.amount} /></Table.Td>
                    <Table.Td><div className="coleta-situacao">{situacao(c)}</div></Table.Td>
                    <Table.Td actions>{acoes(c)}</Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>

          <div className="sc-mobile-cards">
            {itens.map((c) => (
              <article className={`purch-mobile-card${c.status === "CANCELLED" ? " purch-card-cancelled" : ""}`} key={`${c.id}-mobile`}>
                <div className="purch-mobile-card-header">
                  <div className="purch-mobile-card-title">
                    <strong className="purch-mobile-supplier">{c.collectorName}</strong>
                    <div className="purch-mobile-meta-row"><span className="purch-mobile-date">{formatDate(c.collectionDate)} · certificado {numeroDoCertificado(c)}</span></div>
                  </div>
                  <div className="purch-mobile-card-right">
                    <strong className="purch-mobile-amount"><Money value={c.amount} /></strong>
                  </div>
                </div>
                <div className="purch-mobile-card-body">
                  <div className="purch-mobile-row"><span>Volume</span><span>{litros(c.volumeLiters)}</span></div>
                  <div className="purch-mobile-row"><span>PIX</span><span className="coleta-situacao coleta-situacao-fim">{situacao(c)}</span></div>
                </div>
                {c.status !== "CANCELLED" && <div className="purch-mobile-card-footer"><div className="purch-mobile-actions">{acoes(c)}</div></div>}
              </article>
            ))}
          </div>
        </>
      )}

      {resumo && resumo.months.length > 0 && (
        <section className="coleta-meses" aria-labelledby="coleta-meses-titulo">
          <PanelEyebrow as="h2" id="coleta-meses-titulo">Mês a mês · {year}</PanelEyebrow>
          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th>Mês</Table.Th>
                <Table.Th align="right">Coletas</Table.Th>
                <Table.Th align="right">Volume</Table.Th>
                <Table.Th align="right">Valor</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {resumo.months.map((m) => (
                <Table.Row key={m.month}>
                  <Table.Td>{nomeDoMes(m.month)}</Table.Td>
                  <Table.Td align="right">{m.collections}</Table.Td>
                  <Table.Td align="right">{litros(m.liters)}</Table.Td>
                  <Table.Td align="right" style={{ fontWeight: 600 }}><Money value={m.amount} /></Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </section>
      )}

      <Dialog
        open={etapa?.tipo === "form"}
        onOpenChange={(aberto) => { if (!aberto && !busy) setEtapa(null); }}
        title={etapa?.tipo === "form" && etapa.id ? "Editar coleta" : "Registrar coleta"}
        description="Copie do certificado (CDF) que o coletor deixou."
        size="md"
      >
        {etapa?.tipo === "form" && (
          <form onSubmit={(e) => { e.preventDefault(); void confirmar(); }}>
            {erroDoDialogo && <Alert tone="error">{erroDoDialogo}</Alert>}
            {etapa.baixada && <Alert tone="info">O PIX já foi baixado no Contas a Receber: data, volume e valor ficam travados.</Alert>}
            <FormGrid cols={2}>
              <TextField label="Data da coleta" type="date" required min="2024-01-01" disabled={etapa.baixada} value={etapa.values.collectionDate} onChange={campo("collectionDate")} />
              <TextField label="Nº do certificado" hint="Número em vermelho no CDF" inputMode="text" maxLength={30} value={etapa.values.certificateNumber} onChange={campo("certificateNumber")} />
              <TextField label="Volume (litros)" inputMode="decimal" required disabled={etapa.baixada} placeholder="70" value={etapa.values.volumeLiters} onChange={campo("volumeLiters")} />
              <TextField
                label="Valor a receber (R$)"
                inputMode="decimal"
                required
                disabled={etapa.baixada}
                placeholder="140,00"
                hint={precoPrevisto !== null ? `= ${precoPrevisto.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} por litro` : "Valor impresso no certificado"}
                value={etapa.values.amount}
                onChange={campo("amount")}
              />
              <TextField label="Coletor" required maxLength={80} value={etapa.values.collectorName} onChange={campo("collectorName")} />
            </FormGrid>
            <Textarea label="Observações" rows={2} maxLength={500} value={etapa.values.notes} onChange={campo("notes")} />
            <div className="coleta-rodape">
              <Button variant="secondary" disabled={busy} onClick={() => setEtapa(null)}>Voltar</Button>
              <Button type="submit" disabled={busy}>{etapa.id ? "Salvar alterações" : "Registrar coleta"}</Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog
        open={etapa?.tipo === "cancelar"}
        onOpenChange={(aberto) => { if (!aberto && !busy) setEtapa(null); }}
        title="Cancelar coleta"
        description="Ela fica no histórico como cancelada, com o motivo, e sai dos totais."
        size="sm"
      >
        {etapa?.tipo === "cancelar" && (
          <form onSubmit={(e) => { e.preventDefault(); void confirmar(); }}>
            {erroDoDialogo && <Alert tone="error">{erroDoDialogo}</Alert>}
            <p className="coleta-resumo-cancelar">
              Certificado <strong>{numeroDoCertificado(etapa.coleta)}</strong> · {formatDate(etapa.coleta.collectionDate)} · <Money value={etapa.coleta.amount} />
            </p>
            <TextField label="Motivo" required minLength={3} maxLength={300} placeholder="Ex.: lançada em duplicidade" value={etapa.motivo} onChange={(e) => setEtapa({ ...etapa, motivo: e.target.value })} />
            <div className="coleta-rodape">
              <Button variant="secondary" disabled={busy} onClick={() => setEtapa(null)}>Voltar</Button>
              <Button type="submit" variant="danger" disabled={busy || etapa.motivo.trim().length < 3}>Cancelar coleta</Button>
            </div>
          </form>
        )}
      </Dialog>
    </div>
  );
}
