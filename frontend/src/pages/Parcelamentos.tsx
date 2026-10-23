import "./parcelamentos/parcelamentos.css";
import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createInstallmentPlan, getInstallmentPlans, InstallmentPlanListItem } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Dialog } from "../components/ui/Dialog";
import { useSession } from "../context/SessionContext";
import { Button, EmptyState, KpiCard, Money, Select, StatusBadge, Table } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { formatDate } from "../utils/format";
import { DetalheParcelamento } from "./parcelamentos/DetalheParcelamento";
import { DadosDoFormulario, FormularioParcelamento } from "./parcelamentos/FormularioParcelamento";

// Parcelamento em lote: o acordo é cadastrado uma vez e cada parcela vira uma conta a pagar.
// Baixa e estorno de cada parcela continuam no Contas a Pagar.

const SITUACAO = {
  ACTIVE: { label: "Ativo", tone: "info" },
  RENEGOTIATED: { label: "Renegociado", tone: "neutral" },
  CANCELLED: { label: "Cancelado", tone: "neutral" }
} as const;

type Filtro = "ATIVOS" | "TODOS";

function Progresso({ plano }: { plano: InstallmentPlanListItem }) {
  const { pagas, total, abertas, atrasadas, quitado } = plano.resumo;
  const pct = total > 0 ? Math.round((pagas / total) * 100) : 0;
  return (
    <div className="parcelamentos-progresso">
      <div className="parcelamentos-trilho" role="img" aria-label={`${pagas} de ${total} parcelas pagas`}><span style={{ width: `${pct}%` }} /></div>
      <small className="parcelamentos-nota">
        {quitado ? "Quitado" : `${pagas} de ${total} pagas · faltam ${abertas}`}{atrasadas > 0 && ` · ${atrasadas} em atraso`}
      </small>
    </div>
  );
}

export function Parcelamentos() {
  const { notice, setNotice } = useNotice();
  const { user } = useSession();
  const podeCriar = hasPermission(user, "installment-plans", "create");
  const podeAlterar = hasPermission(user, "installment-plans", "delete");
  const podeBaixar = hasPermission(user, "payables", "edit");

  const [planos, setPlanos] = useState<InstallmentPlanListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("ATIVOS");
  const [novo, setNovo] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar(silencioso = false) {
    if (!silencioso) setLoading(true);
    try {
      setPlanos(await getInstallmentPlans());
    } catch (error) {
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "Erro ao carregar os parcelamentos." });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const itens = useMemo(() => (planos ?? []).filter((p) => filtro === "TODOS" || p.status === "ACTIVE"), [planos, filtro]);
  const ativos = (planos ?? []).filter((p) => p.status === "ACTIVE");
  const saldo = ativos.reduce((s, p) => s + p.resumo.saldoAberto, 0);
  const atrasadas = ativos.reduce((s, p) => s + p.resumo.atrasadas, 0);

  async function criar(d: DadosDoFormulario) {
    setBusy(true);
    setErro(null);
    try {
      const criado = await createInstallmentPlan({
        supplierId: d.supplierId, companyId: d.companyId, productId: d.productId, description: d.description,
        total: d.total, quantidade: d.quantidade, parcelas: d.parcelas,
        paymentMethodId: d.paymentMethodId || null, notes: d.notes || null
      });
      setNotice({ tone: "success", message: `Parcelamento criado com ${criado.installmentCount} parcelas no Contas a Pagar.` });
      setNovo(false);
      await carregar(true);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível criar o parcelamento.");
    } finally {
      setBusy(false);
    }
  }

  const botaoNovo = podeCriar ? (
    <Button className="parcelamentos-novo" leadingIcon={<Plus size={16} />} onClick={() => { setErro(null); setNovo(true); }}>Novo parcelamento</Button>
  ) : null;

  return (
    <div className="page-content parcelamentos">
      <Notice notice={notice} />

      <p className="parcelamentos-intro">
        Cadastre o acordo <strong>uma vez</strong>: cada parcela vira uma conta a pagar, com competência no mês do vencimento.
        Dê a baixa e o estorno de cada parcela no <strong>Contas a Pagar</strong>, ou quite várias de uma vez abrindo o parcelamento.
      </p>

      <section className="parcelamentos-kpis" aria-label="Resumo">
        <KpiCard label="Parcelamentos ativos" value={ativos.length} tone="info" sub={ativos.length ? "Com parcelas a pagar" : "Nenhum no momento"} />
        <KpiCard label="Saldo em aberto" moneyValue={saldo} tone={saldo > 0 ? "warning" : "success"} sub="Soma das parcelas que faltam" />
        <KpiCard label="Parcelas em atraso" value={atrasadas} tone={atrasadas > 0 ? "danger" : "success"} sub={atrasadas > 0 ? "Venceram e não foram pagas" : "Tudo em dia"} />
      </section>

      <div className="parcelamentos-barra">
        <Select aria-label="Mostrar" value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} options={[{ value: "ATIVOS", label: "Só ativos" }, { value: "TODOS", label: "Todos" }]} />
        <Button variant="secondary" leadingIcon={<RefreshCw size={14} />} disabled={loading} onClick={() => void carregar(true)}>Atualizar</Button>
        {botaoNovo}
      </div>

      {loading && !planos ? (
        <div className="page-loading">Carregando parcelamentos…</div>
      ) : itens.length === 0 ? (
        <EmptyState
          title="Nenhum parcelamento."
          description="Cadastre o acordo com fornecedor, valor, número de parcelas e vencimentos."
          action={podeCriar ? <Button leadingIcon={<Plus size={16} />} onClick={() => { setErro(null); setNovo(true); }}>Novo parcelamento</Button> : undefined}
        />
      ) : (
        <>
          <div className="sc-desktop-list">
            <Table>
              <Table.Head>
                <Table.Row>
                  <Table.Th>Parcelamento</Table.Th>
                  <Table.Th>Fornecedor</Table.Th>
                  <Table.Th align="right">Total</Table.Th>
                  <Table.Th>Andamento</Table.Th>
                  <Table.Th align="right">Saldo</Table.Th>
                  <Table.Th>Próximo vencimento</Table.Th>
                  <Table.Th>Situação</Table.Th>
                  <Table.Th actions>Ações</Table.Th>
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {itens.map((p) => (
                  <Table.Row key={p.id}>
                    <Table.Td>{p.description}</Table.Td>
                    <Table.Td>{p.supplierName}</Table.Td>
                    <Table.Td align="right"><Money value={p.totalAmount} /></Table.Td>
                    <Table.Td><Progresso plano={p} /></Table.Td>
                    <Table.Td align="right" style={{ fontWeight: 600 }}><Money value={p.resumo.saldoAberto} /></Table.Td>
                    <Table.Td>{p.resumo.proximoVencimento ? formatDate(p.resumo.proximoVencimento) : "—"}</Table.Td>
                    <Table.Td><StatusBadge tone={SITUACAO[p.status].tone}>{SITUACAO[p.status].label}</StatusBadge></Table.Td>
                    <Table.Td actions><Button size="sm" variant="secondary" onClick={() => setAberto(p.id)}>Abrir</Button></Table.Td>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table>
          </div>

          <div className="sc-mobile-cards">
            {itens.map((p) => (
              <article className="purch-mobile-card" key={`${p.id}-mobile`}>
                <div className="purch-mobile-card-header">
                  <div className="purch-mobile-card-title">
                    <strong className="purch-mobile-supplier">{p.description}</strong>
                    <div className="purch-mobile-meta-row"><span className="purch-mobile-date">{p.supplierName}</span></div>
                  </div>
                  <div className="purch-mobile-card-right"><strong className="purch-mobile-amount"><Money value={p.resumo.saldoAberto} /></strong></div>
                </div>
                <div className="purch-mobile-card-body">
                  <div className="purch-mobile-row"><span>Andamento</span><span><Progresso plano={p} /></span></div>
                  <div className="purch-mobile-row"><span>Próximo vencimento</span><span>{p.resumo.proximoVencimento ? formatDate(p.resumo.proximoVencimento) : "—"}</span></div>
                </div>
                <div className="purch-mobile-card-footer"><div className="purch-mobile-actions"><Button size="sm" variant="secondary" onClick={() => setAberto(p.id)}>Abrir</Button></div></div>
              </article>
            ))}
          </div>
        </>
      )}

      <Dialog open={novo} onOpenChange={(o) => { if (!o && !busy) setNovo(false); }} title="Novo parcelamento" description="Cada parcela vira uma conta a pagar, com competência no mês do vencimento." size="lg">
        {novo && <FormularioParcelamento modo="novo" busy={busy} erro={erro} onVoltar={() => setNovo(false)} onEnviar={(d) => void criar(d)} />}
      </Dialog>

      <Dialog open={aberto !== null} onOpenChange={(o) => { if (!o) setAberto(null); }} title="Parcelamento" size="lg">
        {aberto && <DetalheParcelamento planId={aberto} podeBaixar={podeBaixar} podeAlterar={podeAlterar} onAlterou={() => void carregar(true)} onFechar={() => setAberto(null)} />}
      </Dialog>
    </div>
  );
}
