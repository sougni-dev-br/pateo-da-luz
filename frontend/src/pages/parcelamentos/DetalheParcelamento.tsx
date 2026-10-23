import { Ban, ExternalLink, HandCoins, Repeat } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cancelInstallmentPlan,
  getInstallmentPlan,
  InstallmentPlanDetail,
  InstallmentPlanInstallment,
  getPaymentMethods,
  payInstallment,
  PaymentMethod,
  renegotiateInstallmentPlan
} from "../../api/client";
import { Alert, Button, Money, Select, StatusBadge, Table, TextField } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { formatDate } from "../../utils/format";
import { DadosDoFormulario, FormularioParcelamento } from "./FormularioParcelamento";
import { parcelasSugeridas, repartirAcrescimo, repartirDesconto, valorDoCampo } from "./regras";

type Props = {
  planId: string;
  podeBaixar: boolean;
  podeAlterar: boolean;
  onAlterou: () => void;
  onFechar: () => void;
};

type Etapa = { tipo: "detalhe" } | { tipo: "quitar" } | { tipo: "renegociar" } | { tipo: "cancelar"; motivo: string };

const ROTA_CONTAS_A_PAGAR = "/financeiro/contas-a-pagar";
const TOM = { PAGA: "success", ABERTA: "warning", CANCELADA: "neutral" } as const;
const ROTULO = { PAGA: "Paga", ABERTA: "Em aberto", CANCELADA: "Cancelada" } as const;

export function DetalheParcelamento({ planId, podeBaixar, podeAlterar, onAlterou, onFechar }: Props) {
  const navigate = useNavigate();
  const [plano, setPlano] = useState<InstallmentPlanDetail | null>(null);
  const [etapa, setEtapa] = useState<Etapa>({ tipo: "detalhe" });
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [dataPagamento, setDataPagamento] = useState(hojeLocalIso());
  const [desconto, setDesconto] = useState("");
  const [acrescimo, setAcrescimo] = useState("");
  const [motivoDesconto, setMotivoDesconto] = useState("");
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [formaPagamentoId, setFormaPagamentoId] = useState("");

  async function carregar() {
    try {
      setPlano(await getInstallmentPlan(planId));
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível carregar o parcelamento.");
    }
  }
  useEffect(() => { void carregar(); }, [planId]); // eslint-disable-line react-hooks/exhaustive-deps

  const abertas = (plano?.parcelas ?? []).filter((p) => p.situacao === "ABERTA");
  const ativo = plano?.status === "ACTIVE";

  function abrirQuitar() {
    setErro(null);
    if (formas.length === 0) getPaymentMethods().then(setFormas).catch(() => setErro("Não foi possível carregar as formas de pagamento."));
    setEscolhidas(new Set(parcelasSugeridas(abertas, hojeLocalIso())));
    setDesconto("");
    setAcrescimo("");
    setMotivoDesconto("");
    setEtapa({ tipo: "quitar" });
  }

  function alternar(id: string) {
    setEscolhidas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id); else proximo.add(id);
      return proximo;
    });
  }

  const selecionadas: InstallmentPlanInstallment[] = abertas.filter((p) => p.installmentId && escolhidas.has(p.installmentId));
  const descontoNumero = desconto.trim() ? valorDoCampo(desconto) : 0;
  const acrescimoNumero = acrescimo.trim() ? valorDoCampo(acrescimo) : 0;
  const ajusteInvalido = descontoNumero === null || acrescimoNumero === null;
  const descontoEAcrescimo = (descontoNumero ?? 0) > 0 && (acrescimoNumero ?? 0) > 0;
  const partesDesconto = descontoNumero === null ? null : repartirDesconto(selecionadas.map((p) => p.amount), descontoNumero);
  const partesAcrescimo = acrescimoNumero === null ? null : repartirAcrescimo(selecionadas.length, acrescimoNumero);
  // Valor a pagar de cada parcela marcada: desconto tira, juros/multa soma. Só um dos dois por vez.
  const partes = partesDesconto && partesAcrescimo && !descontoEAcrescimo
    ? partesAcrescimo.map((mais, i) => Math.round((mais - partesDesconto[i]) * 100) / 100)
    : null;
  const temAjuste = (descontoNumero ?? 0) > 0 || (acrescimoNumero ?? 0) > 0;
  const totalAPagar = selecionadas.reduce((s, p) => s + p.amount, 0) - (descontoNumero ?? 0) + (acrescimoNumero ?? 0);
  const quitarOk = selecionadas.length > 0 && partes !== null && Boolean(dataPagamento) && Boolean(formaPagamentoId) && (!temAjuste || motivoDesconto.trim().length >= 3);

  // Cada baixa passa pela mesma rota do Contas a Pagar (trava de período, data futura, valor): se uma falhar, as já feitas ficam e a tela diz quantas.
  async function quitar() {
    if (!partes) return;
    setBusy(true);
    setErro(null);
    let feitas = 0;
    try {
      for (let i = 0; i < selecionadas.length; i += 1) {
        const p = selecionadas[i];
        const valorPago = Math.round((p.amount + partes[i]) * 100) / 100;
        await payInstallment(p.installmentId as string, {
          paidDate: dataPagamento,
          paidAmount: valorPago,
          paidPaymentMethodId: formaPagamentoId,
          paidPaymentMethodName: formas.find((m) => m.id === formaPagamentoId)?.name ?? null,
          payingCompanyId: plano?.companyId ?? null,
          differenceReason: partes[i] !== 0 ? motivoDesconto.trim() : null,
          paymentNotes: `Quitação do parcelamento: ${plano?.description ?? ""}`.slice(0, 200)
        });
        feitas += 1;
      }
      setAviso(`${feitas} ${feitas === 1 ? "parcela baixada" : "parcelas baixadas"}.`);
      setEtapa({ tipo: "detalhe" });
    } catch (error) {
      const base = error instanceof Error ? error.message : "Não foi possível baixar.";
      setErro(feitas > 0 ? `${feitas} de ${selecionadas.length} parcelas já foram baixadas. Parou em: ${base}` : base);
    } finally {
      setBusy(false);
      await carregar();
      onAlterou();
    }
  }

  async function renegociar(dados: DadosDoFormulario) {
    setBusy(true);
    setErro(null);
    try {
      const r = await renegotiateInstallmentPlan(planId, {
        quantidade: dados.quantidade, total: dados.total, motivo: dados.motivo, parcelas: dados.parcelas
      });
      setAviso(`Saldo renegociado: canceladas ${r.parcelasCanceladas} em aberto; novo parcelamento criado.`);
      onAlterou();
      setEtapa({ tipo: "detalhe" });
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível renegociar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelar(motivo: string) {
    setBusy(true);
    setErro(null);
    try {
      const r = await cancelInstallmentPlan(planId, motivo);
      setAviso(`Parcelamento cancelado. Em aberto canceladas: ${r.parcelasCanceladas}; pagas mantidas: ${r.parcelasPagasMantidas}.`);
      onAlterou();
      setEtapa({ tipo: "detalhe" });
      await carregar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível cancelar.");
    } finally {
      setBusy(false);
    }
  }

  if (!plano) return <div className="page-loading">{erro ?? "Carregando parcelamento…"}</div>;

  if (etapa.tipo === "renegociar") {
    return (
      <>
        <Alert tone="info">{abertas.length === 1 ? "A parcela em aberto será cancelada e vira" : `As ${abertas.length} parcelas em aberto serão canceladas e viram`} um novo parcelamento. As já pagas não mudam.</Alert>
        <FormularioParcelamento modo="renegociar" saldo={plano.resumo.saldoAberto} busy={busy} erro={erro} onVoltar={() => setEtapa({ tipo: "detalhe" })} onEnviar={(d) => void renegociar(d)} />
      </>
    );
  }

  if (etapa.tipo === "quitar") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (quitarOk) void quitar(); }}>
        {erro && <Alert tone="error">{erro}</Alert>}
        <p className="parcelamentos-conferencia">
          Já marquei as vencidas e as que vencem em até 30 dias. Ajuste como precisar: cada parcela é baixada como no Contas a Pagar.
        </p>
        <div className="parcelamentos-atalhos">
          <Button size="sm" variant="secondary" onClick={() => setEscolhidas(new Set(abertas.flatMap((p) => (p.installmentId ? [p.installmentId] : []))))}>Marcar todas</Button>
          <Button size="sm" variant="secondary" onClick={() => setEscolhidas(new Set(parcelasSugeridas(abertas, hojeLocalIso())))}>Só vencidas e próximas</Button>
          <Button size="sm" variant="secondary" onClick={() => setEscolhidas(new Set())}>Desmarcar</Button>
        </div>
        <div className="parcelamentos-grade">
          {abertas.map((p) => (
            <label key={p.purchaseId}>
              <input type="checkbox" checked={Boolean(p.installmentId && escolhidas.has(p.installmentId))} onChange={() => p.installmentId && alternar(p.installmentId)} />{" "}
              Parcela {p.numero} · vence {formatDate(p.dueDate)} · <Money value={p.amount} />
            </label>
          ))}
        </div>
        <div className="parcelamentos-grade-linha" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <TextField label="Data do pagamento" type="date" required max={hojeLocalIso()} value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
          <TextField label="Desconto total (R$)" inputMode="decimal" placeholder="0,00" hint="Dividido entre as parcelas marcadas" value={desconto} onChange={(e) => setDesconto(e.target.value)} />
          <TextField label="Juros e multa total (R$)" inputMode="decimal" placeholder="0,00" hint="Atraso: entra na baixa, não no acordo" value={acrescimo} onChange={(e) => setAcrescimo(e.target.value)} />
        </div>
        <Select label="Forma de pagamento" required value={formaPagamentoId} onChange={(e) => setFormaPagamentoId(e.target.value)} placeholder="Escolha" options={formas.map((m) => ({ value: m.id, label: m.name }))} />
        {temAjuste && <TextField label="Motivo do desconto ou dos juros" required minLength={3} maxLength={200} value={motivoDesconto} onChange={(e) => setMotivoDesconto(e.target.value)} />}
        {ajusteInvalido && <Alert tone="error">Valor de desconto ou juros inválido.</Alert>}
        {descontoEAcrescimo && <Alert tone="error">Informe só desconto ou só juros e multa.</Alert>}
        {!ajusteInvalido && !descontoEAcrescimo && partes === null && selecionadas.length > 0 && <Alert tone="error">O desconto não pode zerar uma parcela.</Alert>}
        <p className="parcelamentos-conferencia">Total a pagar: <strong><Money value={Math.max(0, totalAPagar)} /></strong></p>
        <div className="parcelamentos-rodape">
          <Button variant="secondary" disabled={busy} onClick={() => setEtapa({ tipo: "detalhe" })}>Voltar</Button>
          <Button type="submit" disabled={busy || !quitarOk}>Baixar {selecionadas.length} {selecionadas.length === 1 ? "parcela" : "parcelas"}</Button>
        </div>
      </form>
    );
  }

  if (etapa.tipo === "cancelar") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); void cancelar(etapa.motivo.trim()); }}>
        {erro && <Alert tone="error">{erro}</Alert>}
        <p className="parcelamentos-conferencia">{abertas.length === 1 ? "A parcela em aberto sai" : `As ${abertas.length} parcelas em aberto saem`} do Contas a Pagar. As parcelas já pagas não mudam: para desfazer um pagamento, estorne no Contas a Pagar.</p>
        <TextField label="Motivo" required minLength={3} maxLength={300} value={etapa.motivo} onChange={(e) => setEtapa({ tipo: "cancelar", motivo: e.target.value })} />
        <div className="parcelamentos-rodape">
          <Button variant="secondary" disabled={busy} onClick={() => setEtapa({ tipo: "detalhe" })}>Voltar</Button>
          <Button type="submit" variant="danger" disabled={busy || etapa.motivo.trim().length < 3}>Cancelar parcelamento</Button>
        </div>
      </form>
    );
  }

  const r = plano.resumo;
  return (
    <div>
      {aviso && <Alert tone="success">{aviso}</Alert>}
      {erro && <Alert tone="error">{erro}</Alert>}
      <p className="parcelamentos-conferencia">
        {plano.supplierName} · total <strong><Money value={plano.totalAmount} /></strong> · {r.pagas} de {r.total} pagas
        {r.abertas > 0 && <> · faltam <strong>{r.abertas}</strong> (<Money value={r.saldoAberto} />)</>}
        {r.atrasadas > 0 && <> · <strong>{r.atrasadas} em atraso</strong></>}
        {plano.excludeFromDre && <> · <strong>fora do DRE</strong></>}
      </p>
      <Table>
        <Table.Head>
          <Table.Row>
            <Table.Th>Parcela</Table.Th>
            <Table.Th>Vencimento</Table.Th>
            <Table.Th align="right">Valor</Table.Th>
            <Table.Th>Situação</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {plano.parcelas.map((p) => (
            <Table.Row key={p.purchaseId}>
              <Table.Td>{p.numero}/{plano.installmentCount}</Table.Td>
              <Table.Td>{formatDate(p.dueDate)}</Table.Td>
              <Table.Td align="right"><Money value={p.situacao === "PAGA" ? (p.paidAmount ?? p.amount) : p.amount} /></Table.Td>
              <Table.Td>
                <StatusBadge tone={TOM[p.situacao]}>{ROTULO[p.situacao]}</StatusBadge>
                {p.situacao === "PAGA" && p.paidDate && <small className="parcelamentos-nota"> em {formatDate(p.paidDate)}</small>}
              </Table.Td>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
      <div className="parcelamentos-rodape">
        <Button variant="secondary" leadingIcon={<ExternalLink size={14} />} onClick={() => navigate(ROTA_CONTAS_A_PAGAR)}>Abrir no Contas a Pagar</Button>
        {ativo && podeBaixar && abertas.length > 0 && <Button variant="secondary" leadingIcon={<HandCoins size={14} />} onClick={abrirQuitar}>Quitar / antecipar</Button>}
        {ativo && podeAlterar && abertas.length > 0 && <Button variant="secondary" leadingIcon={<Repeat size={14} />} onClick={() => { setErro(null); setEtapa({ tipo: "renegociar" }); }}>Renegociar saldo</Button>}
        {ativo && podeAlterar && <Button variant="danger" leadingIcon={<Ban size={14} />} onClick={() => { setErro(null); setEtapa({ tipo: "cancelar", motivo: "" }); }}>Cancelar</Button>}
        <Button onClick={onFechar}>Fechar</Button>
      </div>
    </div>
  );
}
