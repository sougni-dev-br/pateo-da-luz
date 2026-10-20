import { CheckCircle2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createTaxPayment, getCompanies, getTaxCategorySuggestion, getTaxDreCategories, getTaxPayment, getTaxPayments, updateTaxPayment,
  type Company, type TaxDreCategory, type TaxPayment, type TaxPaymentDetail,
} from "../../api/client";
import { DRE_GROUPS, dreGroupLabel } from "../../components/DRECategoryOptions";
import { Button, FormField, FormGrid, FormSection, Money, Select, Switch, TextField, Textarea } from "../../design-system";
import { formatarDiaDaGuia, resumoDaGuia } from "../../lib/guia-imposto";
import { maskMoney, numeroBr } from "../../utils/format";
import { Janela } from "../payables/Janela";
import {
  FORM_VAZIO, TIPOS_DE_GUIA, TIPOS_EM_DESTAQUE, formDaGuia, formDuplicado, mesSugerido, payloadDaGuia, validarGuia,
  type ErrosGuia, type FormGuia,
} from "./formularioGuia";
import { rotuloMes, ultimoDiaDoMes } from "./regras";
import "../payables/payables.css";
import "./tax-payments.css";

type Props = {
  /** Id da guia a editar; null para lançar uma nova. */
  editId: string | null;
  /** Guia de origem quando é uma duplicação. */
  duplicarDe?: string | null;
  hoje: string;
  podeEditar: boolean;
  onFechar: () => void;
  onSalvo: (mensagem: string) => void;
};

export function ModalGuia({ editId, duplicarDe = null, hoje, podeEditar, onFechar, onSalvo }: Props) {
  const emEdicao = editId != null;
  const [form, setForm] = useState<FormGuia>(FORM_VAZIO);
  const [detalhe, setDetalhe] = useState<TaxPaymentDetail | null>(null);
  const [carregando, setCarregando] = useState(emEdicao || duplicarDe != null);
  const [categorias, setCategorias] = useState<TaxDreCategory[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [categoriaEscolhida, setCategoriaEscolhida] = useState(false);
  const [competenciaDigitada, setCompetenciaDigitada] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [duplicada, setDuplicada] = useState<TaxPayment | null>(null);
  const erroRef = useRef<HTMLParagraphElement>(null);

  const campo = <K extends keyof FormGuia>(k: K, v: FormGuia[K]) => setForm((f) => ({ ...f, [k]: v }));
  const editavel = podeEditar && !salvando;

  useEffect(() => {
    getTaxDreCategories().then(setCategorias).catch(() => setErroApi("Não consegui carregar as categorias do DRE."));
    // Quem lança guia nem sempre pode ver Empresas: sem a lista, a empresa fica em campos livres.
    getCompanies().then(setEmpresas).catch(() => setEmpresas([]));
  }, []);

  useEffect(() => {
    const origem = editId ?? duplicarDe;
    if (!origem) return;
    getTaxPayment(origem)
      .then((d) => {
        setDetalhe(d);
        setForm(emEdicao ? formDaGuia(d) : formDuplicado(d));
        setCategoriaEscolhida(Boolean(d.dreCategoryId));
        setCompetenciaDigitada(emEdicao);
      })
      .catch(() => setErroApi("Não consegui carregar a guia."))
      .finally(() => setCarregando(false));
  }, [editId, duplicarDe, emEdicao]);

  // Enquanto a pessoa não escolhe, a categoria segue o tipo da guia (resposta atrasada é descartada).
  useEffect(() => {
    // Guia já gravada não muda de categoria sozinha: a sugestão vale só para guia nova.
    if (emEdicao || categoriaEscolhida || !form.documentType) return;
    let descartada = false;
    const t = setTimeout(() => {
      getTaxCategorySuggestion(form.documentType, form.description)
        .then((s) => { if (!descartada) setForm((f) => ({ ...f, dreCategoryId: s.dreCategoryId ?? "" })); })
        .catch(() => undefined);
    }, 300);
    return () => { descartada = true; clearTimeout(t); };
  }, [emEdicao, form.documentType, form.description, categoriaEscolhida]);

  // Aviso de guia repetida: mesmo tipo, mesma competência e mesmo valor.
  useEffect(() => {
    const valor = numeroBr(form.amount);
    if (!form.documentType || !form.mes || !(valor > 0)) { setDuplicada(null); return; }
    let descartada = false;
    const t = setTimeout(() => {
      getTaxPayments({ documentType: form.documentType, competenceStart: `${form.mes}-01`, competenceEnd: ultimoDiaDoMes(form.mes), pageSize: 50 })
        .then((r) => {
          if (descartada) return;
          const igual = r.data.find((g) => g.id !== editId && g.status !== "CANCELED"
            && g.documentType === form.documentType && Number(g.amount) === valor);
          setDuplicada(igual ?? null);
        })
        .catch(() => undefined);
    }, 400);
    return () => { descartada = true; clearTimeout(t); };
  }, [form.documentType, form.mes, form.amount, editId]);

  const erros: ErrosGuia = useMemo(() => (tentou ? validarGuia(form, emEdicao, hoje) : {}), [tentou, form, emEdicao, hoje]);

  function escolherTipo(tipo: string) {
    setForm((f) => {
      const proximo = { ...f, documentType: tipo };
      return competenciaDigitada ? proximo : { ...proximo, mes: mesSugerido(tipo, f.dueDate) };
    });
  }

  function mudarVencimento(dueDate: string) {
    setForm((f) => (competenciaDigitada ? { ...f, dueDate } : { ...f, dueDate, mes: mesSugerido(f.documentType, dueDate) }));
  }

  function escolherEmpresa(id: string) {
    const e = empresas.find((x) => x.id === id);
    setForm((f) => ({ ...f, companyId: id, cnpj: e?.cnpj ?? "", legalName: e?.legalName ?? "", tradeName: e?.tradeName ?? "" }));
  }

  async function salvar() {
    setTentou(true);
    setErroApi(null);
    if (Object.keys(validarGuia(form, emEdicao, hoje)).length > 0) return;
    setSalvando(true);
    try {
      const payload = payloadDaGuia(form, emEdicao, categoriaEscolhida);
      if (emEdicao && editId) {
        await updateTaxPayment(editId, payload);
        onSalvo("Guia atualizada.");
      } else {
        await createTaxPayment(payload);
        onSalvo(`Guia lançada. Já aparece em Contas a Pagar (vence em ${formatarDiaDaGuia(form.dueDate)}) e entra no DRE de ${rotuloMes(form.mes)}.`);
      }
    } catch (e) {
      setErroApi(e instanceof Error ? e.message : "Não foi possível salvar.");
      setSalvando(false);
      requestAnimationFrame(() => erroRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
    }
  }

  const categoria = categorias.find((c) => c.id === form.dreCategoryId);
  const opcoesCategoria = useMemo(() => {
    const ordem = new Map(DRE_GROUPS.map((g, i) => [g.value, i]));
    const ordenadas = [...categorias].sort((a, b) =>
      (ordem.get(a.dreGroup) ?? 99) - (ordem.get(b.dreGroup) ?? 99) || a.name.localeCompare(b.name, "pt-BR"));
    return [{ value: "", label: "Sem categoria" }, ...ordenadas.map((c) => ({ value: c.id, label: c.name, group: dreGroupLabel(c.dreGroup) }))];
  }, [categorias]);

  const tipoForaDoDestaque = form.documentType !== "" && !TIPOS_EM_DESTAQUE.includes(form.documentType);
  const paga = Boolean(detalhe?.paymentDate);
  const titulo = emEdicao ? (podeEditar ? "Editar guia" : "Guia") : duplicarDe ? "Duplicar guia" : "Lançar guia de imposto";
  const avisoCategoria = form.documentType && !form.dreCategoryId
    ? "Sem categoria, a guia entra em \"Não categorizadas\" no DRE, fora do grupo Impostos."
    : !categoriaEscolhida && form.documentType ? "Sugerida pelo tipo da guia." : null;

  if (carregando) {
    return <Janela eyebrow="Impostos e guias" titulo={titulo} onFechar={onFechar}><p className="ip-carregando" role="status">Carregando…</p></Janela>;
  }

  return (
    <Janela eyebrow="Impostos e guias" titulo={titulo} onFechar={onFechar} ocupado={salvando} largura="media">
      <form onSubmit={(e) => { e.preventDefault(); void salvar(); }} noValidate className="ip-form">
        <FormSection eyebrow="Passo 1" title="Qual guia?">
          <div className="ip-tipos" role="group" aria-label="Tipo da guia">
            {TIPOS_EM_DESTAQUE.map((t) => (
              <button key={t} type="button" className="ip-tipo" aria-pressed={form.documentType === t} disabled={!editavel} onClick={() => escolherTipo(t)}>{t}</button>
            ))}
            <Select
              aria-label="Outro tipo de guia"
              className={tipoForaDoDestaque ? "ip-tipo-select ip-tipo-select--ativo" : "ip-tipo-select"}
              placeholder="Outro tipo…"
              value={tipoForaDoDestaque ? form.documentType : ""}
              disabled={!editavel}
              onChange={(e) => e.target.value && escolherTipo(e.target.value)}
              options={TIPOS_DE_GUIA.filter((t) => !TIPOS_EM_DESTAQUE.includes(t)).map((t) => ({ value: t, label: t }))}
            />
          </div>
          {erros.documentType && <small className="ip-erro" role="alert">{erros.documentType}</small>}

          <FormGrid cols={3}>
            <FormField label="Competência" required error={erros.mes} hint={!competenciaDigitada && form.mes ? "Sugerida: mês anterior ao vencimento." : "Mês a que o imposto se refere. Entra no DRE por ele."}>
              <TextField type="month" value={form.mes} disabled={!editavel} onChange={(e) => { setCompetenciaDigitada(true); campo("mes", e.target.value); }} />
            </FormField>
            <FormField label="Vencimento" required error={erros.dueDate}>
              <TextField type="date" value={form.dueDate} disabled={!editavel} onChange={(e) => mudarVencimento(e.target.value)} />
            </FormField>
            <FormField label="Valor da guia" required error={erros.amount}>
              <TextField inputMode="decimal" placeholder="0,00" value={form.amount} disabled={!editavel} onChange={(e) => campo("amount", maskMoney(e.target.value))} />
            </FormField>
          </FormGrid>

          {duplicada && (
            <p className="ip-aviso" role="status">
              <TriangleAlert size={16} aria-hidden="true" />
              Já existe {duplicada.documentType} de {form.mes ? rotuloMes(form.mes) : ""} no mesmo valor (vence em {formatarDiaDaGuia(duplicada.dueDate)}). Confira se não é a mesma guia.
            </p>
          )}
        </FormSection>

        <FormSection eyebrow="Passo 2" title="Empresa e DRE" description="Quem recolhe a guia e onde ela entra no DRE.">
          <FormGrid cols={2}>
            {empresas.length > 0 ? (
              <FormField label="Empresa (opcional)">
                <Select placeholder="Selecione a empresa" value={form.companyId} disabled={!editavel} onChange={(e) => escolherEmpresa(e.target.value)}
                  options={empresas.map((e) => ({ value: e.id, label: `${e.tradeName} · ${e.cnpj}` }))} />
              </FormField>
            ) : (
              <FormField label="Empresa (CNPJ ou razão social)">
                <TextField value={form.legalName || form.cnpj} disabled={!editavel} placeholder="Opcional"
                  onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value, cnpj: "" }))} />
              </FormField>
            )}
            <FormField label="Categoria no DRE" hint={avisoCategoria ?? undefined}>
              <Select value={form.dreCategoryId} disabled={!editavel} options={opcoesCategoria}
                onChange={(e) => { setCategoriaEscolhida(true); campo("dreCategoryId", e.target.value); }} />
            </FormField>
          </FormGrid>
          <FormField label="Descrição" hint="Ex.: o que a guia paga.">
            <TextField value={form.description} disabled={!editavel} onChange={(e) => campo("description", e.target.value)} />
          </FormField>
        </FormSection>

        <FormSection eyebrow="Passo 3" title="Pagamento e observações">
          {emEdicao ? (
            <p className="ip-pagamento-lido">
              {paga
                ? <>Paga em <b>{formatarDiaDaGuia(detalhe?.paymentDate)}</b>, <b><Money value={Number(detalhe?.paidAmount ?? 0)} /></b>. Para estornar, use Contas a Pagar.</>
                : "Ainda não paga. Para dar baixa, use o botão Pagar na lista."}
            </p>
          ) : (
            <>
              <div className="ip-ja-paga">
                <Switch label="Já paguei esta guia" checked={form.jaPaga} disabled={!editavel} onChange={(v) => campo("jaPaga", v)} />
                <span>Já paguei esta guia</span>
              </div>
              {form.jaPaga && (
                <FormGrid cols={2}>
                  <FormField label="Data do pagamento" required error={erros.paymentDate}>
                    <TextField type="date" max={hoje} value={form.paymentDate} onChange={(e) => campo("paymentDate", e.target.value)} />
                  </FormField>
                  <FormField label="Valor pago" error={erros.paidAmount} hint="Vazio = o valor da guia.">
                    <TextField inputMode="decimal" value={form.paidAmount} onChange={(e) => campo("paidAmount", maskMoney(e.target.value))} />
                  </FormField>
                </FormGrid>
              )}
            </>
          )}
          {emEdicao && podeEditar && (
            <FormField label="Situação da guia" hint={paga ? "Guia paga não pode ser cancelada: estorne o pagamento antes." : "Cancelada sai de Contas a Pagar e do DRE."}>
              <Select value={form.cancelada ? "CANCELED" : "ATIVA"} disabled={!editavel} onChange={(e) => campo("cancelada", e.target.value === "CANCELED")}
                options={[{ value: "ATIVA", label: "Ativa" }, { value: "CANCELED", label: "Cancelada", disabled: paga }]} />
            </FormField>
          )}
          <FormField label="Comentários"><Textarea rows={2} value={form.comments} disabled={!editavel} onChange={(e) => campo("comments", e.target.value)} /></FormField>
        </FormSection>

        {podeEditar && !form.cancelada && (
          <div className="ip-resumo" aria-live="polite">
            <strong>O que acontece ao salvar</strong>
            <ul>
              {resumoDaGuia({ amount: String(numeroBr(form.amount) || ""), dueDate: form.dueDate, competenceDate: form.mes ? `${form.mes}-01` : "", categoriaNome: categoria?.name ?? null })
                .map((linha) => <li key={linha}><CheckCircle2 size={14} aria-hidden="true" />{linha}</li>)}
            </ul>
          </div>
        )}

        {erroApi && <p ref={erroRef} className="field-hint field-hint--alerta" role="alert">{erroApi}</p>}

        <div className="modal-actions">
          <Button variant="secondary" onClick={onFechar} disabled={salvando}>{podeEditar ? "Cancelar" : "Fechar"}</Button>
          {podeEditar && (
            <Button type="submit" disabled={salvando}>{salvando ? "Salvando…" : emEdicao ? "Salvar alterações" : "Lançar guia"}</Button>
          )}
        </div>
      </form>
    </Janela>
  );
}
