import type { TaxCode, TaxPaymentDetail, TaxPaymentItemInput, TaxPaymentPayload } from "../../api/client";
import { competenciaSugerida } from "../../lib/competencia-imposto";
import { maskMoney, moneyToMasked, numeroBr } from "../../utils/format";
import { modeloDoTipo, sugestoesDoTipo } from "./modelosDeGuia";
import { competenciaDoMes, mesDaData } from "./regras";

export const TIPOS_DE_GUIA = [
  "FGTS", "GPS / INSS", "DARF", "DARF IR", "IRRF", "Simples Nacional / DAS", "DAS MEI", "DASN",
  "DARE", "DARE-SP", "GARE ICMS", "GARE ISS", "TFE", "IPTU", "ISS",
  "Parcelamento Tributário", "Outros",
];

// Os tipos que quase todo lançamento usa ficam à vista; os demais, no seletor.
// Lista do filtro de tipo da tela: os tipos padrão primeiro e, depois, os que existem nas guias e não estão entre eles (a
// importação de planilha grava o texto livre da coluna, ex.: "RECEITA FEDERAL"). O filtro é de tipo exato, então sem isso
// essas guias não seriam alcançáveis. Compara sem diferenciar caixa e não repete.
export function tiposParaOFiltro(existentes: ReadonlyArray<string>): string[] {
  const visto = new Set(TIPOS_DE_GUIA.map((t) => t.toLowerCase()));
  const extras: string[] = [];
  for (const bruto of existentes) {
    const tipo = bruto.trim();
    if (!tipo || visto.has(tipo.toLowerCase())) continue;
    visto.add(tipo.toLowerCase());
    extras.push(tipo);
  }
  return [...TIPOS_DE_GUIA, ...extras.sort((a, b) => a.localeCompare(b, "pt-BR"))];
}

export const TIPOS_EM_DESTAQUE = ["Simples Nacional / DAS", "DAS MEI", "FGTS", "GPS / INSS", "DARF"];

// Uma linha da composição da guia (código, denominação, principal, multa e juros), com os valores como o usuário digita.
export type LinhaForm = {
  chave: string;
  /** Linha que veio do modelo do tipo: a denominação já vem preenchida e travada. */
  doModelo: boolean;
  code: string;
  description: string;
  principal: string;
  fine: string;
  interest: string;
};

export type FormGuia = {
  documentType: string;
  /** Mês da competência no formato do campo de mês (AAAA-MM). */
  mes: string;
  dueDate: string;
  companyId: string;
  cnpj: string;
  legalName: string;
  tradeName: string;
  documentNumber: string;
  /** FGTS: quantidade de trabalhadores (texto do campo; vazio = não informado). */
  workersCount: string;
  /** FGTS de rescisão: o funcionário desligado (vazio = guia sem vínculo). */
  employeeId: string;
  dreCategoryId: string;
  comments: string;
  cancelada: boolean;
  /** Total impresso no documento ("Valor Total do Documento"), para conferir com a soma das linhas. Opcional. */
  totalDoPapel: string;
  linhas: LinhaForm[];
};

let contador = 0;
export function novaLinha(parcial: Partial<LinhaForm> = {}): LinhaForm {
  contador += 1;
  return { chave: `l${contador}`, doModelo: false, code: "", description: "", principal: "", fine: "", interest: "", ...parcial };
}

export const FORM_VAZIO: FormGuia = {
  documentType: "", mes: "", dueDate: "", companyId: "", cnpj: "", legalName: "", tradeName: "", documentNumber: "", workersCount: "", employeeId: "",
  dreCategoryId: "", comments: "", cancelada: false, totalDoPapel: "", linhas: [],
};

export function linhasDoModelo(tipo: string): LinhaForm[] {
  return modeloDoTipo(tipo).linhas.map((l) => novaLinha({ code: l.code, description: l.description, doModelo: Boolean(l.description) }));
}

// Em centavos para não acumular erro de ponto flutuante na soma.
const centavos = (texto: string) => Math.round(numeroBr(texto) * 100);

export function totalDaLinha(l: Pick<LinhaForm, "principal" | "fine" | "interest">): number {
  return (centavos(l.principal) + centavos(l.fine) + centavos(l.interest)) / 100;
}

export function totalDaGuia(linhas: ReadonlyArray<LinhaForm>): number {
  return linhas.reduce((s, l) => s + Math.round(totalDaLinha(l) * 100), 0) / 100;
}

// Só as linhas com valor valem: as do modelo que ficaram em branco (ex.: FGTS Rescisório) são ignoradas.
export function linhasComValor(linhas: ReadonlyArray<LinhaForm>): LinhaForm[] {
  return linhas.filter((l) => totalDaLinha(l) > 0);
}

// Texto das denominações com valor: serve para sugerir a categoria (o DARF se separa em INSS e IRRF por ele).
export function descricaoDasLinhas(linhas: ReadonlyArray<LinhaForm>): string {
  return linhasComValor(linhas).map((l) => l.description.trim()).filter(Boolean).join(" · ");
}

// Ao digitar uma denominação conhecida do tipo, o código vem sozinho.
export function codigoDaDenominacao(tipo: string, description: string): string | null {
  const achada = sugestoesDoTipo(tipo).find((l) => l.description.toLowerCase() === description.trim().toLowerCase());
  return achada ? achada.code : null;
}

export function formDaGuia(d: TaxPaymentDetail): FormGuia {
  // Guia antiga ou importada por planilha não tem linhas: vira uma linha só, com o valor da guia.
  const linhas = d.items && d.items.length > 0
    ? d.items.map((i) => novaLinha({
        code: i.code ?? "", description: i.description,
        principal: moneyToMasked(i.principal), fine: Number(i.fine) > 0 ? moneyToMasked(i.fine) : "", interest: Number(i.interest) > 0 ? moneyToMasked(i.interest) : "",
      }))
    : [novaLinha({ description: (d.description || d.documentType).slice(0, 200), principal: moneyToMasked(d.amount) })];
  return {
    documentType: d.documentType,
    mes: mesDaData(d.competenceDate),
    dueDate: d.dueDate.slice(0, 10),
    companyId: d.companyId ?? "",
    cnpj: d.cnpj ?? "",
    legalName: d.legalName ?? "",
    tradeName: d.tradeName ?? "",
    documentNumber: d.documentNumber ?? "",
    workersCount: d.workersCount != null ? String(d.workersCount) : "",
    employeeId: d.employeeId ?? "",
    dreCategoryId: d.dreCategoryId ?? "",
    comments: d.comments ?? "",
    cancelada: d.status === "CANCELED",
    totalDoPapel: "",
    linhas,
  };
}

// Duplicar copia a guia e deixa em branco o que muda a cada emissão (competência, vencimento e número do documento).
export function formDuplicado(d: TaxPaymentDetail): FormGuia {
  return { ...formDaGuia(d), mes: "", dueDate: "", documentNumber: "", workersCount: "", employeeId: "", cancelada: false, totalDoPapel: "" };
}

// Competência sugerida (mês anterior ao vencimento) só para os tipos que seguem essa regra.
export function mesSugerido(documentType: string, dueDate: string): string {
  return competenciaSugerida(documentType, dueDate).slice(0, 7);
}

// Diferença entre a soma das linhas e o total impresso (em centavos, para não somar erro de ponto flutuante).
// null quando o total do papel não foi informado.
export function diferencaComOPapel(f: Pick<FormGuia, "linhas" | "totalDoPapel">): number | null {
  if (!f.totalDoPapel.trim()) return null;
  return (Math.round(totalDaGuia(f.linhas) * 100) - Math.round(numeroBr(f.totalDoPapel) * 100)) / 100;
}

// ─── denominação travada: o código traz o texto, que vem do catálogo guardado no sistema ───────────────────────
export function descricaoDoCodigo(catalogo: ReadonlyArray<TaxCode>, codigo: string): string | null {
  const c = codigo.trim();
  return c ? (catalogo.find((x) => x.code === c)?.description ?? null) : null;
}

// Tipo "livre" (IPTU, ISS, taxas...): não tem código nem modelo, então a denominação é digitada.
export function tipoSemCatalogo(tipo: string, catalogo: ReadonlyArray<TaxCode>): boolean {
  return catalogo.length === 0 && modeloDoTipo(tipo).linhas.every((l) => !l.code);
}

export type EstadoDaDenominacao = "travada" | "aguardaCodigo" | "livre";

// travada: veio do modelo ou do catálogo (não se altera); aguardaCodigo: espera o código ser digitado;
// livre: código novo (a pessoa informa a denominação e o sistema guarda) ou tipo sem catálogo.
export function estadoDaDenominacao(l: LinhaForm, tipo: string, catalogo: ReadonlyArray<TaxCode>): EstadoDaDenominacao {
  if (l.doModelo) return "travada";
  if (l.code.trim()) return descricaoDoCodigo(catalogo, l.code) != null ? "travada" : "livre";
  // Tipo cujo documento não traz código (ISS, IPTU, FGTS...): a denominação é livre mesmo que alguém já tenha guardado um
  // código no catálogo dele; senão a linha sem código ficaria esperando um código que o papel não tem.
  return tipoSemCatalogo(tipo, catalogo) || modeloDoTipo(tipo).linhas.every((m) => !m.code) ? "livre" : "aguardaCodigo";
}

// FGTS com valor em "Rescisório" ou "Indenização compensatória": a guia é de um funcionário que saiu.
export function temVerbaDeRescisao(f: Pick<FormGuia, "documentType" | "linhas">): boolean {
  return f.documentType === "FGTS" && f.linhas.some((l) => /rescis|indeniza/i.test(l.description) && totalDaLinha(l) > 0);
}

// ─── pendências: o que ainda impede de lançar a guia ───────────────────────────────────────────────────────────
export type Pendencia = {
  /** Qual campo resolve: tipo, empresa, vencimento, competencia, numero, linhas, categoria, papel ou linha:<chave>. */
  campo: string;
  texto: string;
};

export type ContextoDasPendencias = {
  emEdicao: boolean;
  /** Guia paga: valores travados, as linhas não entram na conferência. */
  valoresFixos: boolean;
  /** Há empresas cadastradas: escolher uma é obrigatório (os CNPJs do grupo são diferentes). */
  exigeEmpresa: boolean;
  /** A lista de empresas falhou ao carregar (rede, servidor lento): sem ela a guia seria gravada sem empresa. */
  empresasIndisponiveis?: boolean;
  /** Tipo e linhas não têm categoria automática no DRE: a pessoa precisa escolher. */
  exigeCategoria: boolean;
  catalogo: ReadonlyArray<TaxCode>;
  /** Já existe guia ativa com o mesmo número de documento. */
  numeroRepetido: string | null;
  /** Quem lança pode ver Funcionários: a guia com verba de rescisão precisa de um funcionário desligado. */
  podeVincularFuncionario?: boolean;
};

const dinheiro = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function pendenciasDaGuia(f: FormGuia, ctx: ContextoDasPendencias): Pendencia[] {
  const p: Pendencia[] = [];
  if (!f.documentType) p.push({ campo: "tipo", texto: "Escolha o tipo da guia." });
  if (!ctx.emEdicao && ctx.empresasIndisponiveis) p.push({ campo: "empresa", texto: "Não consegui carregar a lista de empresas. Tente de novo antes de lançar: sem a empresa a guia ficaria fora do controle por CNPJ." });
  else if (!ctx.emEdicao && ctx.exigeEmpresa && !f.companyId) p.push({ campo: "empresa", texto: "Escolha a empresa (o CNPJ que está no documento)." });
  if (!f.dueDate) p.push({ campo: "vencimento", texto: "Informe o vencimento (pagar até)." });
  if (!f.cancelada && !f.mes) p.push({ campo: "competencia", texto: "Informe a competência. Sem ela a guia fica fora do DRE e não pode ser lançada." });
  if (!ctx.emEdicao && f.documentType) {
    const modelo = modeloDoTipo(f.documentType);
    if (modelo.numeroObrigatorio && !f.documentNumber.trim()) {
      p.push({ campo: "numero", texto: `Informe o ${modelo.rotuloDocumento.toLowerCase()} (está no documento).` });
    }
  }
  if (!ctx.emEdicao && f.documentType && modeloDoTipo(f.documentType).pedeTrabalhadores && !f.workersCount.trim()) {
    p.push({ campo: "trabalhadores", texto: "Informe a quantidade de trabalhadores (está no documento)." });
  }
  if (!ctx.emEdicao && ctx.podeVincularFuncionario && temVerbaDeRescisao(f) && !f.employeeId) {
    p.push({ campo: "funcionario", texto: "Guia com verba de rescisão: escolha o funcionário desligado a que ela se refere." });
  }
  if (ctx.numeroRepetido) p.push({ campo: "numero", texto: `Já existe a guia nº ${ctx.numeroRepetido}. Edite a existente em vez de lançar outra.` });

  if (!ctx.valoresFixos) {
    const comValor = linhasComValor(f.linhas);
    if (comValor.length === 0) p.push({ campo: "linhas", texto: "Informe o valor de ao menos uma linha da guia." });
    for (const l of comValor) {
      if (l.description.trim()) continue;
      const n = f.linhas.indexOf(l) + 1;
      const estado = estadoDaDenominacao(l, f.documentType, ctx.catalogo);
      p.push({
        campo: `linha:${l.chave}`,
        texto: l.code.trim() || estado === "livre" ? `Linha ${n}: informe a denominação${l.code.trim() ? ` do código ${l.code.trim()}` : ""}.` : `Linha ${n}: informe o código (a denominação vem dele).`,
      });
    }
    const dif = diferencaComOPapel(f);
    if (dif != null && dif !== 0) {
      p.push({ campo: "papel", texto: `A soma das linhas difere do total do papel em ${dinheiro(Math.abs(dif))}. Confira as linhas ou apague o total do papel.` });
    }
  }
  if (!ctx.emEdicao && ctx.exigeCategoria && !f.dreCategoryId) {
    p.push({ campo: "categoria", texto: "Escolha a categoria do DRE: o tipo e as linhas desta guia não têm categoria automática." });
  }
  return p;
}

export function itensDoPayload(linhas: ReadonlyArray<LinhaForm>): TaxPaymentItemInput[] {
  return linhasComValor(linhas).map((l) => ({
    code: l.code.trim() || null,
    description: l.description.trim(),
    principal: numeroBr(l.principal),
    fine: numeroBr(l.fine),
    interest: numeroBr(l.interest),
  }));
}

// Corpo enviado à API. As linhas definem o valor da guia (o servidor soma); guia já paga não envia valores
// (para mudá-los, estornar o pagamento em Contas a Pagar), e o pagamento nunca é enviado por aqui.
export function payloadDaGuia(f: FormGuia, emEdicao: boolean, categoriaEscolhida: boolean, paga: boolean): TaxPaymentPayload {
  const base: TaxPaymentPayload = {
    companyId: f.companyId || null,
    cnpj: f.cnpj || null,
    legalName: f.legalName || null,
    tradeName: f.tradeName || null,
    documentType: f.documentType,
    documentNumber: f.documentNumber.trim() || null,
    employeeId: f.documentType === "FGTS" && f.employeeId ? f.employeeId : null,
    workersCount: modeloDoTipo(f.documentType).pedeTrabalhadores && f.workersCount.trim() ? Number(f.workersCount) : null,
    competenceDate: competenciaDoMes(f.mes) || null,
    dueDate: f.dueDate,
    comments: f.comments || null,
    // Sem escolha da pessoa vai undefined e o servidor sugere pelo tipo e pelas linhas finais (a sugestão da tela
    // chega com atraso e podia levar a categoria de linhas que a pessoa já trocou); null é "sem categoria".
    dreCategoryId: categoriaEscolhida ? (f.dreCategoryId || null) : undefined,
  };
  const comItens: TaxPaymentPayload = paga ? base : { ...base, items: itensDoPayload(f.linhas) };
  if (emEdicao) return { ...comItens, status: f.cancelada ? "CANCELED" : "PENDING" };
  return comItens;
}

export { maskMoney };

// Valor colado de outro lugar ("1.234,56", "1234,56", "1.234"): a máscara de digitação (que enche os centavos da direita)
// transformaria "1.234" em 12,34. Na colagem, vírgula é o decimal; sem vírgula, "1.234" com 3 dígitos depois do ponto é milhar.
export function valorColado(texto: string): string {
  // Negativo (estorno, "(1.250,00)", "1.250,00-") não é valor de guia: antes o sinal sumia e o valor entrava positivo.
  // Cobre o sinal no começo, no fim e antes do número no meio do texto ("Valor: -1.250,00", "Estorno – R$ 50,00"); o hífen
  // entre dígitos (data, faixa colada junto) não conta como sinal.
  if (/^\s*(R\$\s*)?[-−–(]/.test(texto) || /\d\s*[-−–]\s*$/.test(texto) || /(^|[^\d])\s*[-−–]\s*(R\$\s*)?\d/.test(texto)) return "";
  const limpo = texto.replace(/[^\d.,]/g, "");
  if (!limpo) return "";
  // Formato americano ("1,613.84", "1,613,456"): vírgula é milhar e ponto é decimal. "1,613" sozinho segue como decimal
  // brasileiro (ambíguo), como sempre.
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(limpo) && (limpo.includes(".") || (limpo.match(/,/g) ?? []).length >= 2)) {
    const americano = Number(limpo.replace(/,/g, ""));
    return americano > 0 ? moneyToMasked(americano) : "";
  }
  const milharBr = /^\d{1,3}(\.\d{3})+$/.test(limpo);
  const numero = limpo.includes(",") || milharBr ? numeroBr(limpo.replace(/\./g, "").replace(",", ".")) : numeroBr(limpo);
  return numero > 0 ? moneyToMasked(numero) : "";
}

// O que a pessoa digitou (valores, número, observações...), sem o que o sistema preenche sozinho (linhas do modelo, categoria,
// competência sugerida, empresa lembrada): serve para saber se fechar o modal perde trabalho.
export function fotoDoFormulario(f: FormGuia, emEdicao = false): string {
  return JSON.stringify({
    // Linha do modelo só conta com valor; linha livre, com qualquer coisa digitada. Linha vazia não é trabalho.
    linhas: f.linhas
      .filter((l) => l.principal || l.fine || l.interest || (!l.doModelo && (l.code || l.description)))
      .map((l) => (l.doModelo ? [l.code, l.principal, l.fine, l.interest] : [l.code, l.description, l.principal, l.fine, l.interest])),
    numero: f.documentNumber.trim(), papel: f.totalDoPapel, obs: f.comments.trim(), trabalhadores: f.workersCount, vencimento: f.dueDate, funcionario: f.employeeId,
    // Guia já gravada: tudo o que a tela mostra é dado dela, então mudar tipo, competência, empresa, categoria ou situação
    // também é trabalho a perder. Na guia nova esses campos são preenchidos pelo sistema e ficam de fora.
    ...(emEdicao ? { tipo: f.documentType, mes: f.mes, empresa: f.companyId || f.cnpj || f.legalName, categoria: f.dreCategoryId, cancelada: f.cancelada } : {}),
  });
}

// Número do documento comparado só por letras e dígitos, como no servidor.
export function chaveDoNumero(numero: string): string {
  return numero.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Tipo de guia a abrir quando falta lançar um imposto (o grupo vem da categoria do DRE).
export function tipoDoGrupo(grupo: string): string | null {
  switch (grupo) {
    case "Simples Nacional": return "Simples Nacional / DAS";
    case "FGTS": return "FGTS";
    // O INSS da empresa vem no DARF previdenciário (códigos 1082 e 1099), não na GPS.
    case "INSS": return "DARF";
    case "IRRF / DARF":
    case "DARF": return "DARF";
    case "GARE / ICMS": return "GARE ICMS";
    case "IPTU": return "IPTU";
    default: return null;
  }
}
