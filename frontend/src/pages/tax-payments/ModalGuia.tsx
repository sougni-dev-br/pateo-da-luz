import { CheckCircle2, CircleAlert, ExternalLink, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  createTaxPayment, getCompanies, getTaxCategorySuggestion, getTaxCodes, getTaxDreCategories, getTaxPayment, getTaxPayments, updateTaxPayment,
  type Company, type TaxCode, type TaxDreCategory, type TaxPayment, type TaxPaymentDetail,
} from "../../api/client";
import { DRE_GROUPS, dreGroupLabel } from "../../components/DRECategoryOptions";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Button, FormField, FormGrid, FormSection, Money, Select, Switch, TextField, Textarea } from "../../design-system";
import { formatarDiaDaGuia, resumoDaGuia } from "../../lib/guia-imposto";
import { Janela } from "../payables/Janela";
import {
  FORM_VAZIO, TIPOS_DE_GUIA, TIPOS_EM_DESTAQUE, chaveDoNumero, descricaoDasLinhas, diferencaComOPapel, formDaGuia, formDuplicado,
  linhasComValor, linhasDoModelo, mesSugerido, payloadDaGuia, pendenciasDaGuia, totalDaGuia, type FormGuia, type LinhaForm,
} from "./formularioGuia";
import { LinhasDaGuia } from "./LinhasDaGuia";
import { modeloDoTipo } from "./modelosDeGuia";
import { mesDaData, rotuloMes } from "./regras";
import "../payables/payables.css";
import "./tax-payments.css";

export type InicialDaGuia = { tipo?: string; mes?: string; dueDate?: string };

/** O que a guia lançada deixa para a tela: com isso ela oferece "Lançar outra guia" já com vencimento e competência. */
export type GuiaSalva = { dueDate: string; mes: string };

type Props = {
  /** Id da guia a editar; null para lançar uma nova. */
  editId: string | null;
  /** Guia de origem quando é uma duplicação. */
  duplicarDe?: string | null;
  /** Tipo, competência e vencimento já escolhidos (ex.: vindos do alerta "falta lançar guia de FGTS"). */
  inicial?: InicialDaGuia;
  podeEditar: boolean;
  /** Cancelar ou reativar a guia pede a permissão de excluir. */
  podeCancelar: boolean;
  /** Atalho para a guia em Contas a Pagar (onde se estorna um pagamento); omitido para quem não vê essa tela. */
  onContasAPagar?: (guia: TaxPayment) => void;
  onFechar: () => void;
  /** `guia` vem só quando uma guia nova foi lançada. */
  onSalvo: (mensagem: string, guia?: GuiaSalva) => void;
};

const CHAVE_EMPRESA = "impostos:ultimaEmpresa:";

// Lembrar a última empresa de cada tipo poupa um clique por guia no lote do dia 20. Só conveniência: sem armazenamento, segue sem lembrar.
function empresaLembrada(tipo: string): string {
  try { return localStorage.getItem(CHAVE_EMPRESA + tipo) ?? ""; } catch { return ""; }
}
function lembrarEmpresa(tipo: string, id: string) {
  try { if (id) localStorage.setItem(CHAVE_EMPRESA + tipo, id); } catch { /* sem armazenamento: não lembra */ }
}

function cnpjComMascara(cnpj: string): string {
  const d = cnpj.replace(/\D/g, "");
  return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : cnpj;
}

function formInicial(inicial?: InicialDaGuia): FormGuia {
  const base = { ...FORM_VAZIO, mes: inicial?.mes ?? "", dueDate: inicial?.dueDate ?? "" };
  return inicial?.tipo ? { ...base, documentType: inicial.tipo, linhas: linhasDoModelo(inicial.tipo) } : base;
}

export function ModalGuia({ editId, duplicarDe = null, inicial, podeEditar, podeCancelar, onContasAPagar, onFechar, onSalvo }: Props) {
  const emEdicao = editId != null;
  const [form, setForm] = useState<FormGuia>(() => formInicial(inicial));
  const [detalhe, setDetalhe] = useState<TaxPaymentDetail | null>(null);
  const [carregando, setCarregando] = useState(emEdicao || duplicarDe != null);
  const [categorias, setCategorias] = useState<TaxDreCategory[]>([]);
  const [empresas, setEmpresas] = useState<Company[]>([]);
  const [catalogo, setCatalogo] = useState<TaxCode[]>([]);
  const [categoriaEscolhida, setCategoriaEscolhida] = useState(false);
  // A categoria vem do tipo e das linhas: true = veio automática (campo travado); false = não há regra para esta guia
  // (a pessoa escolhe e isso é pendência); null = ainda não consultada.
  const [categoriaAuto, setCategoriaAuto] = useState<boolean | null>(null);
  const [competenciaDigitada, setCompetenciaDigitada] = useState(Boolean(inicial?.mes));
  // Enquanto as linhas não são mexidas, trocar o tipo troca as linhas pelas do modelo do tipo.
  const [linhasMexidas, setLinhasMexidas] = useState(emEdicao || duplicarDe != null);
  const [mostrarMultaJuros, setMostrarMultaJuros] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [repetida, setRepetida] = useState<TaxPayment | null>(null);
  const [confirmarModelo, setConfirmarModelo] = useState(false);
  const [tipoPendente, setTipoPendente] = useState<string | null>(null);
  const erroRef = useRef<HTMLParagraphElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const campo = <K extends keyof FormGuia>(k: K, v: FormGuia[K]) => setForm((f) => ({ ...f, [k]: v }));
  const editavel = podeEditar && !salvando;
  // Guia paga está fechada: valores só mudam depois de estornar o pagamento em Contas a Pagar.
  const paga = Boolean(detalhe?.paymentDate);
  const valoresFixos = emEdicao && paga;

  useEffect(() => {
    getTaxDreCategories().then(setCategorias).catch(() => setErroApi("Não consegui carregar as categorias do DRE."));
    // Quem lança guia nem sempre pode ver Empresas: sem a lista, a empresa fica em campo livre.
    getCompanies().then(setEmpresas).catch(() => setEmpresas([]));
  }, []);

  useEffect(() => {
    const origem = editId ?? duplicarDe;
    if (!origem) return;
    getTaxPayment(origem)
      .then((d) => {
        setDetalhe(d);
        const f = emEdicao ? formDaGuia(d) : formDuplicado(d);
        setForm(f);
        // Guia que já tem multa ou juros mostra as colunas; as demais começam recolhidas.
        setMostrarMultaJuros(f.linhas.some((l) => l.fine.trim() !== "" || l.interest.trim() !== ""));
        setCategoriaEscolhida(Boolean(d.dreCategoryId));
        setCategoriaAuto(emEdicao ? Boolean(d.dreCategoryId) : null);
        setCompetenciaDigitada(emEdicao);
      })
      .catch(() => setErroApi("Não consegui carregar a guia."))
      .finally(() => setCarregando(false));
  }, [editId, duplicarDe, emEdicao]);

  // Códigos conhecidos do tipo: o código digitado traz a denominação (travada).
  useEffect(() => {
    if (!form.documentType) { setCatalogo([]); return; }
    let descartada = false;
    getTaxCodes(form.documentType).then((c) => { if (!descartada) setCatalogo(c); }).catch(() => { if (!descartada) setCatalogo([]); });
    return () => { descartada = true; };
  }, [form.documentType]);

  // Guia nova: a empresa da última guia deste tipo já vem escolhida (continua editável).
  useEffect(() => {
    if (emEdicao || duplicarDe || !form.documentType || form.companyId || empresas.length === 0) return;
    const e = empresas.find((x) => x.id === empresaLembrada(form.documentType));
    if (e) setForm((f) => (f.companyId ? f : { ...f, companyId: e.id, cnpj: e.cnpj, legalName: e.legalName, tradeName: e.tradeName }));
  }, [emEdicao, duplicarDe, form.documentType, form.companyId, empresas]);

  const descricaoDasLinhasAtual = descricaoDasLinhas(form.linhas);

  // A categoria do DRE vem do tipo e das linhas da guia (resposta atrasada é descartada); sem regra, a pessoa escolhe.
  useEffect(() => {
    // Guia já gravada não muda de categoria sozinha.
    if (emEdicao || categoriaEscolhida || !form.documentType) return;
    let descartada = false;
    const t = setTimeout(() => {
      getTaxCategorySuggestion(form.documentType, descricaoDasLinhasAtual)
        .then((s) => {
          if (descartada) return;
          setCategoriaAuto(s.dreCategoryId != null);
          setForm((f) => ({ ...f, dreCategoryId: s.dreCategoryId ?? "" }));
        })
        .catch(() => undefined);
    }, 300);
    return () => { descartada = true; clearTimeout(t); };
  }, [emEdicao, form.documentType, descricaoDasLinhasAtual, categoriaEscolhida]);

  // Aviso de guia repetida: o número do documento é único por emissão (comparado só por letras e dígitos).
  useEffect(() => {
    const numero = form.documentNumber.trim();
    if (chaveDoNumero(numero).length < 4) { setRepetida(null); return; }
    let descartada = false;
    const t = setTimeout(() => {
      getTaxPayments({ search: numero, pageSize: 10 })
        .then((r) => {
          if (descartada) return;
          const chave = chaveDoNumero(numero);
          setRepetida(r.data.find((g) => g.id !== editId && g.status !== "CANCELED" && chaveDoNumero(g.documentNumber ?? "") === chave) ?? null);
        })
        .catch(() => undefined);
    }, 400);
    return () => { descartada = true; clearTimeout(t); };
  }, [form.documentNumber, editId]);

  const modelo = modeloDoTipo(form.documentType);
  const diferenca = diferencaComOPapel(form);

  // O que ainda impede de lançar: a guia só conclui com tudo resolvido.
  const pendencias = useMemo(() => (podeEditar ? pendenciasDaGuia(form, {
    emEdicao, valoresFixos, exigeEmpresa: empresas.length > 0, exigeCategoria: categoriaAuto === false, catalogo,
    numeroRepetido: repetida?.documentNumber ?? null,
  }) : []), [podeEditar, form, emEdicao, valoresFixos, empresas.length, categoriaAuto, catalogo, repetida]);
  const linhasPendentes = pendencias.filter((p) => p.campo.startsWith("linha:")).map((p) => p.campo.slice(6));

  function aplicarTipo(tipo: string, refazerLinhas: boolean) {
    setForm((f) => {
      const proximo = { ...f, documentType: tipo };
      const comMes = competenciaDigitada ? proximo : { ...proximo, mes: mesSugerido(tipo, f.dueDate) };
      return refazerLinhas ? { ...comMes, linhas: linhasDoModelo(tipo), totalDoPapel: "" } : comMes;
    });
    if (refazerLinhas) setLinhasMexidas(false);
    // Outro tipo, outra categoria automática: consulta de novo.
    if (!emEdicao) { setCategoriaEscolhida(false); setCategoriaAuto(null); }
  }

  function escolherTipo(tipo: string) {
    if (tipo === form.documentType) return;
    // Trocar o tipo depois de digitar valores apagaria o que foi digitado: confirma antes.
    if (linhasMexidas && !emEdicao && linhasComValor(form.linhas).length > 0) { setTipoPendente(tipo); return; }
    aplicarTipo(tipo, !linhasMexidas);
  }

  function mudarLinhas(linhas: LinhaForm[]) {
    setLinhasMexidas(true);
    campo("linhas", linhas);
  }

  function mudarVencimento(dueDate: string) {
    setForm((f) => (competenciaDigitada ? { ...f, dueDate } : { ...f, dueDate, mes: mesSugerido(f.documentType, dueDate) }));
  }

  function escolherEmpresa(id: string) {
    const e = empresas.find((x) => x.id === id);
    setForm((f) => ({ ...f, companyId: id, cnpj: e?.cnpj ?? "", legalName: e?.legalName ?? "", tradeName: e?.tradeName ?? "" }));
  }

  // Enter num campo nunca grava a guia (era fácil lançar pela metade): grava pelo botão ou com Ctrl+Enter.
  function teclarNoFormulario(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key !== "Enter" || (e.target as HTMLElement).tagName !== "INPUT") return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) void salvar();
  }

  // Clicar numa pendência leva ao campo que a resolve.
  function irParaPendencia(campoDaPendencia: string) {
    const raiz = formRef.current;
    if (!raiz) return;
    const chaveDaLinha = campoDaPendencia.slice(6);
    const alvo = campoDaPendencia.startsWith("linha:")
      ? (raiz.querySelector<HTMLElement>(`[data-linha-nome="${chaveDaLinha}"]:not([readonly])`) ?? raiz.querySelector<HTMLElement>(`[data-linha="${chaveDaLinha}"]`))
      : raiz.querySelector<HTMLElement>(`[data-pend="${campoDaPendencia}"] input:not([readonly]), [data-pend="${campoDaPendencia}"] select, [data-pend="${campoDaPendencia}"] button`);
    if (!alvo) return;
    alvo.scrollIntoView({ block: "center", behavior: "smooth" });
    alvo.focus({ preventScroll: true });
  }

  async function salvar() {
    setErroApi(null);
    if (pendencias.length > 0) return;
    setSalvando(true);
    try {
      const payload = payloadDaGuia(form, emEdicao, categoriaEscolhida, valoresFixos);
      if (emEdicao && editId) {
        await updateTaxPayment(editId, payload);
        onSalvo("Guia atualizada.");
        return;
      }
      await createTaxPayment(payload);
      lembrarEmpresa(form.documentType, form.companyId);
      onSalvo(
        `${form.documentType} lançada. Já aparece em Contas a Pagar (vence em ${formatarDiaDaGuia(form.dueDate)}) e entra no DRE de ${rotuloMes(form.mes)}. A baixa é feita lá.`,
        { dueDate: form.dueDate, mes: form.mes },
      );
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
    return [{ value: "", label: "Selecione a categoria" }, ...ordenadas.map((c) => ({ value: c.id, label: c.name, group: dreGroupLabel(c.dreGroup) }))];
  }, [categorias]);

  const tipoForaDoDestaque = form.documentType !== "" && !TIPOS_EM_DESTAQUE.includes(form.documentType);
  const titulo = emEdicao ? (podeEditar ? "Editar guia" : "Guia") : duplicarDe ? "Duplicar guia" : "Lançar guia de imposto";
  const hintCategoria = !form.documentType
    ? "Vem do tipo e das linhas da guia."
    : categoriaAuto === true ? "Automática: definida pelo tipo e pelas linhas da guia."
    : categoriaAuto === false ? "Este tipo não tem categoria automática: escolha a categoria."
    : emEdicao ? undefined : "Consultando a categoria…";
  const total = totalDaGuia(form.linhas);

  if (carregando) {
    return <Janela eyebrow="Impostos e guias" titulo={titulo} onFechar={onFechar}><p className="ip-carregando" role="status">Carregando…</p></Janela>;
  }

  return (
    <Janela eyebrow="Impostos e guias" titulo={titulo} onFechar={onFechar} ocupado={salvando} largura="larga">
      <form ref={formRef} onSubmit={(e) => { e.preventDefault(); void salvar(); }} onKeyDown={teclarNoFormulario} noValidate className="ip-form">
        <FormSection eyebrow="Passo 1" title="A guia" description="Os dados do cabeçalho do documento de arrecadação.">
          <div className="ip-tipos" role="radiogroup" aria-label="Tipo da guia" data-pend="tipo">
            {TIPOS_EM_DESTAQUE.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={form.documentType === t} className="ip-tipo"
                disabled={!editavel || valoresFixos} onClick={() => escolherTipo(t)}>{t}</button>
            ))}
            <Select
              aria-label="Outro tipo de guia"
              className={tipoForaDoDestaque ? "ip-tipo-select ip-tipo-select--ativo" : "ip-tipo-select"}
              placeholder="Outro tipo…"
              value={tipoForaDoDestaque ? form.documentType : ""}
              disabled={!editavel || valoresFixos}
              onChange={(e) => e.target.value && escolherTipo(e.target.value)}
              options={TIPOS_DE_GUIA.filter((t) => !TIPOS_EM_DESTAQUE.includes(t)).map((t) => ({ value: t, label: t }))}
            />
          </div>

          {/* Na ordem do papel: quem paga, quando vence, o que apurou e o número do documento. */}
          <div data-pend="empresa">
            {empresas.length > 0 ? (
              <FormField label="Empresa (CNPJ no documento)" required={!emEdicao}>
                <Select placeholder="Selecione a empresa" value={form.companyId} disabled={!editavel} onChange={(e) => escolherEmpresa(e.target.value)}
                  options={empresas.map((e) => ({ value: e.id, label: `${cnpjComMascara(e.cnpj)} — ${e.legalName || e.tradeName}` }))} />
              </FormField>
            ) : (
              <FormField label="Empresa (razão social ou CNPJ, opcional)">
                <TextField value={form.legalName || form.cnpj} disabled={!editavel} onChange={(e) => setForm((f) => ({ ...f, legalName: e.target.value, cnpj: "" }))} />
              </FormField>
            )}
          </div>

          <FormGrid cols={3}>
            <div data-pend="vencimento">
              <FormField label="Vencimento (pagar até)" required>
                <TextField type="date" value={form.dueDate} disabled={!editavel} onChange={(e) => mudarVencimento(e.target.value)} />
              </FormField>
            </div>
            <div data-pend="competencia">
              <FormField label="Competência (período de apuração)" required hint={!competenciaDigitada && form.mes ? "Sugerida: mês anterior ao vencimento." : "Entra no DRE por este mês."}>
                <TextField type="month" value={form.mes} disabled={!editavel} onChange={(e) => { setCompetenciaDigitada(true); campo("mes", e.target.value); }} />
              </FormField>
            </div>
            <div data-pend="numero">
              <FormField label={modelo.rotuloDocumento} required={modelo.numeroObrigatorio && !emEdicao} hint="Evita lançar a mesma guia duas vezes.">
                <TextField value={form.documentNumber} disabled={!editavel} placeholder="Ex.: 00.00.00000.0000000-0"
                  onChange={(e) => campo("documentNumber", e.target.value)} />
              </FormField>
            </div>
            {modelo.pedeTrabalhadores && (
              <div data-pend="trabalhadores">
                <FormField label="Quantidade de trabalhadores" required={!emEdicao} hint="Como está na guia.">
                  <TextField inputMode="numeric" value={form.workersCount} disabled={!editavel} placeholder="Ex.: 12"
                    onChange={(e) => campo("workersCount", e.target.value.replace(/\D/g, "").slice(0, 6))} />
                </FormField>
              </div>
            )}
          </FormGrid>
        </FormSection>

        {duplicarDe && (
          <p className="ip-aviso" role="status">
            <TriangleAlert size={16} aria-hidden="true" />
            Guia duplicada: os valores abaixo são os da guia anterior. Confira cada linha com o documento novo antes de lançar.
          </p>
        )}

        <FormSection
          eyebrow="Passo 2"
          title="Composição da guia"
          description={valoresFixos
            ? "Esta guia já foi paga em Contas a Pagar: para mudar os valores, estorne o pagamento lá."
            : "Digite o código de cada linha do documento: a denominação vem dele. O valor da guia é a soma das linhas."}
          actions={editavel && !valoresFixos ? (
            <div className="ip-multa-juros">
              <Switch label="Guia com multa e juros" checked={mostrarMultaJuros} onChange={setMostrarMultaJuros} />
              <span>Com multa e juros</span>
            </div>
          ) : undefined}
        >
          <div data-pend="linhas">
            <LinhasDaGuia
              linhas={form.linhas}
              tipo={form.documentType}
              catalogo={catalogo}
              onChange={mudarLinhas}
              somenteLeitura={!editavel || valoresFixos}
              mostrarMultaJuros={mostrarMultaJuros}
              totalDoPapel={form.totalDoPapel}
              onTotalDoPapel={(t) => campo("totalDoPapel", t)}
              diferenca={diferenca}
              linhasPendentes={linhasPendentes}
            />
          </div>
          {editavel && !valoresFixos && form.documentType && linhasMexidas && (
            <div>
              <Button size="sm" variant="secondary" onClick={() => setConfirmarModelo(true)}>
                Refazer as linhas pelo modelo de {form.documentType}
              </Button>
            </div>
          )}
        </FormSection>

        <FormSection eyebrow="Passo 3" title="DRE e observações">
          <FormGrid cols={2}>
            <div data-pend="categoria">
              <FormField label={categoriaAuto === true ? "Categoria no DRE (automática)" : "Categoria no DRE"} required={categoriaAuto === false && !emEdicao} hint={hintCategoria}>
                <Select value={form.dreCategoryId} disabled={!editavel || categoriaAuto === true} options={opcoesCategoria}
                  onChange={(e) => { setCategoriaEscolhida(true); campo("dreCategoryId", e.target.value); }} />
              </FormField>
            </div>
            {emEdicao && podeEditar && podeCancelar ? (
              <FormField
                label="Situação da guia"
                hint={paga
                  ? "Guia paga não pode ser cancelada: estorne o pagamento antes."
                  : "Cancelada fica no histórico, fora de Contas a Pagar e do DRE. Excluir (menu da lista) manda a guia para a Auditoria."}
              >
                <Select value={form.cancelada ? "CANCELED" : "ATIVA"} disabled={!editavel} onChange={(e) => campo("cancelada", e.target.value === "CANCELED")}
                  options={[{ value: "ATIVA", label: "Ativa" }, { value: "CANCELED", label: "Cancelada", disabled: paga }]} />
              </FormField>
            ) : <span />}
          </FormGrid>
          {emEdicao && (
            <p className="ip-pagamento-lido">
              {paga
                ? <>Paga em <b>{formatarDiaDaGuia(detalhe?.paymentDate)}</b>, <b><Money value={Number(detalhe?.paidAmount ?? 0)} /></b>, pela baixa em Contas a Pagar. {detalhe && onContasAPagar && (
                    <Button size="sm" variant="secondary" leadingIcon={<ExternalLink size={14} />} onClick={() => onContasAPagar(detalhe)}>Abrir em Contas a Pagar para estornar</Button>
                  )}</>
                : "Ainda não paga. A baixa é feita em Contas a Pagar."}
            </p>
          )}
          <FormField label="Observações" hint={modelo.dicaObservacoes}>
            <Textarea rows={2} value={form.comments} disabled={!editavel} onChange={(e) => campo("comments", e.target.value)} />
          </FormField>
        </FormSection>

        {podeEditar && (
          <section className={`ip-pendencias${pendencias.length > 0 ? " ip-pendencias--abertas" : ""}`} aria-live="polite" aria-label="Pendências para lançar">
            {pendencias.length === 0 ? (
              <p className="ip-pendencias-ok"><CheckCircle2 size={16} aria-hidden="true" /> Tudo resolvido: a guia pode ser {emEdicao ? "salva" : "lançada"}.</p>
            ) : (
              <>
                <strong><CircleAlert size={16} aria-hidden="true" /> {pendencias.length === 1 ? "1 pendência" : `${pendencias.length} pendências`} para {emEdicao ? "salvar" : "lançar"} a guia</strong>
                <ul>
                  {pendencias.map((p) => (
                    <li key={`${p.campo}:${p.texto}`}>
                      <button type="button" className="ip-pendencia" onClick={() => irParaPendencia(p.campo)}>{p.texto}</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}

        {podeEditar && !form.cancelada && pendencias.length === 0 && (
          <div className="ip-resumo" aria-live="polite">
            <strong>O que acontece ao salvar</strong>
            <ul>
              {resumoDaGuia({
                amount: String(total || ""), dueDate: form.dueDate, competenceDate: form.mes ? `${form.mes}-01` : "",
                categoriaNome: categoria?.name ?? null, linhas: linhasComValor(form.linhas).length,
              }).map((linha) => <li key={linha}><CheckCircle2 size={14} aria-hidden="true" />{linha}</li>)}
            </ul>
          </div>
        )}

        {erroApi && <p ref={erroRef} className="field-hint field-hint--alerta" role="alert">{erroApi}</p>}

        <div className="modal-actions">
          {pendencias.length > 0 && (
            <button type="button" className="ip-faltam" onClick={() => irParaPendencia(pendencias[0].campo)}>
              {pendencias.length === 1 ? "1 pendência" : `${pendencias.length} pendências`}: resolva para {emEdicao ? "salvar" : "lançar"}
            </button>
          )}
          <Button variant="secondary" onClick={onFechar} disabled={salvando}>Fechar</Button>
          {podeEditar && (
            <Button type="submit" disabled={salvando || pendencias.length > 0} title={pendencias.length > 0 ? "Resolva as pendências para concluir" : undefined}>
              {salvando ? "Salvando…" : emEdicao ? "Salvar alterações" : "Lançar guia"}
            </Button>
          )}
        </div>
      </form>

      <ConfirmDialog
        open={confirmarModelo}
        tone="warning"
        title="Refazer as linhas pelo modelo?"
        description={`As linhas voltam ao modelo de ${form.documentType} e os valores já digitados são apagados.`}
        confirmLabel="Refazer linhas"
        onConfirm={() => { setConfirmarModelo(false); setLinhasMexidas(false); setForm((f) => ({ ...f, linhas: linhasDoModelo(f.documentType), totalDoPapel: "" })); }}
        onCancel={() => setConfirmarModelo(false)}
      />
      <ConfirmDialog
        open={tipoPendente != null}
        tone="warning"
        title={`Trocar para ${tipoPendente ?? ""}?`}
        description={`As linhas voltam ao modelo de ${tipoPendente ?? ""} e os valores já digitados são apagados.`}
        confirmLabel="Trocar o tipo"
        onConfirm={() => { if (tipoPendente) aplicarTipo(tipoPendente, true); setTipoPendente(null); }}
        onCancel={() => setTipoPendente(null)}
      />
    </Janela>
  );
}
