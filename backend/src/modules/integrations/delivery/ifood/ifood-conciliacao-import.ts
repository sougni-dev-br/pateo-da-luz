// Importação do faturamento do iFood a partir do "Relatório de Conciliação" do portal.
//
// O iFood não tem integração ativa com o ERP (ver ifood-receita.ts): o faturamento vive em
// `RevenueEntry`, uma linha MENSAL por loja. Este módulo lê o extrato de lançamentos do portal
// (uma linha por lançamento, várias por pedido) e devolve os totais de cada loja e mês.
// Só contas e leitura de tabela — nada de banco aqui, para poder ser testado.
//
// Regras (as mesmas da importação manual de 21–22/09/2026):
//   vendas      = soma do valor do pedido (valor_cesta_final) dos pedidos NÃO cancelados
//   taxas       = comissão + taxa de transação (lançamentos de cobrança), já líquidas de estorno
//   promoção    = promoção custeada pela loja (subsídio), já líquida de estorno
//   bruto       = vendas − promoção da loja      (mesmo critério da 99 e da Keeta)
//   serviços    = débito de pacote de anúncios e mensalidade (ocorrência avulsa)
//   ajustes     = demais ocorrências avulsas (reembolso/desconto), que o portal soma ao líquido
//   líquido     = vendas + taxas + promoção da loja + serviços + ajustes   (taxas, promoção e serviços
//                 chegam NEGATIVOS no arquivo; um sinal positivo é recusado como arquivo trocado)
// Conferido contra o portal em 3 lojas de outubro/2026 (vendas, taxas, serviços, ajustes e repasses).
// O "saldo devedor de períodos anteriores" é dívida antiga compensada, não custo do mês:
// fica fora do líquido e aparece à parte. Atenção: os saldos se ENCADEIAM de semana em semana
// (cada semana repete a dívida da anterior), então `saldoAnterior` é a soma dos lançamentos e
// não o valor devido — serve só para sinalizar que existe dívida compensada.
// Repasse da semana = soma dos valores DISTINTOS de `valor_transacao` das linhas da semana
// (conferido contra a tela "Repasses do mês" do portal, 5 de 5 semanas).

export type SemanaDeRepasse = { inicio: string; fim: string; previsao: string; valor: number };

export type LojaIfoodMes = {
  lojaId: string;
  lojaIdCurto: string;
  competencia: string;
  pedidos: number;
  vendas: number;
  taxas: number;
  promocaoLoja: number;
  /** Débito de pacote de anúncios e mensalidade: custo de serviço, dentro do líquido (decisão de 21/09). */
  servicos: number;
  /** Outras ocorrências avulsas (reembolso, desconto): o portal as soma ao líquido, em "Ajustes". */
  ajustes: number;
  saldoAnterior: number;
  bruto: number;
  liquido: number;
  liquidoComSaldo: number;
  repasses: SemanaDeRepasse[];
};

/**
 * `erros` bloqueiam tudo; `alertas` apontam números que podem estar errados e exigem confirmação
 * explícita de quem importa; `avisos` são só informativos.
 */
export type LeituraIfood = { lojas: LojaIfoodMes[]; erros: string[]; avisos: string[]; alertas: string[] };

export type LinhaExistente = {
  id: string;
  /** Identificador curto da loja no portal (o `ID` numérico, não o uuid). */
  loja: string;
  competencia: string;
  orders: number;
  grossAmount: number;
  netAmount: number;
};

export type AcaoDaLinha = "CRIAR" | "ALTERAR" | "IGUAL" | "CONFLITO";
export type ValorAnterior = { pedidos: number; bruto: number; liquido: number };
export type ItemDoPlanoIfood = {
  loja: LojaIfoodMes;
  id: string;
  acao: AcaoDaLinha;
  existenteId: string | null;
  /** Valor hoje gravado na linha que será alterada; `null` quando não há linha. */
  anterior: ValorAnterior | null;
};

const CENTAVO = 0.01;
const MAX_LINHAS_POR_ARQUIVO = 100_000;
const VALOR_MAXIMO = 10_000_000;
const PRIMEIRO_ANO_ACEITO = 2020;

const COLUNAS = {
  competencia: ["competencia"],
  fato: ["fato_gerador"],
  tipo: ["tipo_lancamento"],
  descricao: ["descricao_lancamento"],
  valor: ["valor"],
  pedido: ["pedido_associado_ifood"],
  cesta: ["valor_cesta_final"],
  lojaId: ["loja_id"],
  lojaCurto: ["loja_id_curto"],
  inicio: ["data_apuracao_inicio"],
  fim: ["data_apuracao_fim"],
  previsao: ["data_repasse_esperada"],
  transacao: ["valor_transacao"]
} as const;

type ColunaKey = keyof typeof COLUNAS;
const OBRIGATORIAS: ColunaKey[] = ["competencia", "fato", "tipo", "descricao", "valor", "pedido", "cesta", "lojaId"];

function normalizar(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

const arredondar = (valor: number) => Math.round(valor * 100) / 100;

function paraNumero(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = String(valor ?? "").replace(/\s/g, "");
  if (!texto) return null;
  // "1.500" sem vírgula é ambíguo (1,5 ou 1500) e "1,234.56" mistura os dois formatos: recusa em vez de adivinhar.
  if (/^-?\d{1,3}\.\d{3}$/.test(texto)) return null;
  if (/^-?\d+(\.\d+)?$/.test(texto)) return Number(texto);
  if (/^-?(\d{1,3}(\.\d{3})+|\d+),\d+$/.test(texto)) return Number(texto.replace(/\./g, "").replace(",", "."));
  return null;
}

function paraDia(valor: unknown): string | null {
  const m = String(valor instanceof Date ? valor.toISOString() : valor ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Ano-mês de hoje no fuso de Brasília: depois das 21h do último dia do mês o UTC já virou o mês. */
export const mesAtualSaoPaulo = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);

function competenciaValida(competencia: string, hoje: string = mesAtualSaoPaulo()): boolean {
  const m = competencia.match(/^(\d{4})-(\d{2})$/);
  if (!m) return false;
  const mes = Number(m[2]);
  return Number(m[1]) >= PRIMEIRO_ANO_ACEITO && mes >= 1 && mes <= 12 && competencia <= hoje;
}

function mapearColunas(cabecalho: unknown[]): Partial<Record<ColunaKey, number>> {
  const mapa: Partial<Record<ColunaKey, number>> = {};
  cabecalho.forEach((celula, indice) => {
    const nome = normalizar(celula);
    for (const key of Object.keys(COLUNAS) as ColunaKey[]) {
      if (mapa[key] === undefined && (COLUNAS[key] as readonly string[]).includes(nome)) mapa[key] = indice;
    }
  });
  return mapa;
}

type Acumulador = {
  lojaId: string;
  lojaIdCurto: string;
  competencia: string;
  cestaPorPedido: Map<string, number>;
  pedidosComVenda: Set<string>;
  cancelados: Set<string>;
  taxas: number;
  promocaoLoja: number;
  servicos: number;
  ajustes: number;
  saldoAnterior: number;
  semanas: Map<string, { inicio: string; fim: string; previsao: string; valores: Set<number> }>;
};

/** Observações do arquivo inteiro que não pertencem a uma loja só. */
type Observacoes = {
  pedidosSemCesta: Set<string>;
  parciais: Set<string>;
  devolvidoNosParciais: number;
  naoClassificados: Map<string, number>;
};

const ehSaldoDevedor = (descricao: string) => descricao.includes("saldo devedor");
/** Lançamentos de pedido que já estão dentro do valor do pedido ou da entrada financeira: não somam nada à parte. */
const TIPOS_SEM_EFEITO = new Set(["retencao", "entrada financeira"]);

type Lancamento = { fato: string; tipo: string; descricao: string; valor: number; pedido: string };

/** Põe um lançamento no balde certo. O que não cabe em nenhum vai para `naoClassificados`, nunca some. */
function classificar(g: Acumulador, l: Lancamento, obs: Observacoes): void {
  const { fato, tipo, descricao, valor } = l;
  if (ehSaldoDevedor(descricao)) g.saldoAnterior += valor;
  else if (fato.startsWith("ocorrencia avulsa") && /pacote de anuncios|mensalidade/.test(descricao)) g.servicos += valor;
  else if (fato.startsWith("ocorrencia avulsa") || fato.startsWith("ressarcimento") || /^(reembolso|ressarcimento)/.test(tipo)) g.ajustes += valor;
  else if (tipo === "cobranca") g.taxas += valor;
  else if (tipo === "subsidio" && descricao.includes("custeada pela loja")) g.promocaoLoja += valor;
  else if (tipo === "subsidio" && descricao.includes("custeada pelo ifood")) return;
  else if (TIPOS_SEM_EFEITO.has(tipo)) return;
  else {
    const chave = `${tipo} / ${descricao}`;
    obs.naoClassificados.set(chave, (obs.naoClassificados.get(chave) ?? 0) + valor);
  }
}

function acumularPedido(g: Acumulador, l: Lancamento, cesta: number | null, obs: Observacoes): void {
  if (!l.pedido) return;
  if (l.fato.startsWith("cancelamento parcial")) {
    obs.parciais.add(l.pedido);
    if (l.tipo === "entrada financeira") obs.devolvidoNosParciais += l.valor;
  }
  if (l.fato.startsWith("cancelamento total")) g.cancelados.add(l.pedido);
  else if (l.fato === "venda") {
    g.pedidosComVenda.add(l.pedido);
    if (cesta === null || Math.abs(cesta) > VALOR_MAXIMO) obs.pedidosSemCesta.add(l.pedido);
    else if (!g.cestaPorPedido.has(l.pedido)) g.cestaPorPedido.set(l.pedido, cesta);
  }
}

function acumularSemana(g: Acumulador, inicio: string | null, fim: string | null, previsao: string | null, transacao: number | null): void {
  if (!inicio || !fim || !previsao || transacao === null) return;
  const chave = `${inicio}|${fim}`;
  const semana = g.semanas.get(chave) ?? { inicio, fim, previsao, valores: new Set<number>() };
  if (previsao > semana.previsao) semana.previsao = previsao;
  semana.valores.add(arredondar(transacao));
  g.semanas.set(chave, semana);
}

function fecharLoja(g: Acumulador): LojaIfoodMes {
  const validos = [...g.pedidosComVenda].filter((p) => !g.cancelados.has(p) && g.cestaPorPedido.has(p));
  const vendas = arredondar(validos.reduce((soma, p) => soma + g.cestaPorPedido.get(p)!, 0));
  const taxas = arredondar(g.taxas);
  const promocaoLoja = arredondar(g.promocaoLoja);
  const servicos = arredondar(g.servicos);
  const ajustes = arredondar(g.ajustes);
  const liquido = arredondar(vendas + taxas + promocaoLoja + servicos + ajustes);
  const saldoAnterior = arredondar(g.saldoAnterior);
  return {
    lojaId: g.lojaId, lojaIdCurto: g.lojaIdCurto, competencia: g.competencia,
    pedidos: validos.length, vendas, taxas, promocaoLoja, servicos, ajustes, saldoAnterior,
    bruto: arredondar(vendas + promocaoLoja), liquido, liquidoComSaldo: arredondar(liquido + saldoAnterior),
    repasses: [...g.semanas.values()]
      .map((sem) => ({ inicio: sem.inicio, fim: sem.fim, previsao: sem.previsao, valor: arredondar([...sem.valores].reduce((a, b) => a + b, 0)) }))
      .sort((a, b) => a.inicio.localeCompare(b.inicio))
  };
}

const brl = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MAX_ERROS_MOSTRADOS = 20;

function limitarErros(erros: string[]): string[] {
  if (erros.length <= MAX_ERROS_MOSTRADOS) return erros;
  return [...erros.slice(0, MAX_ERROS_MOSTRADOS), `... e mais ${erros.length - MAX_ERROS_MOSTRADOS} erro(s) parecidos.`];
}

function erroDeSinal(lojas: LojaIfoodMes[]): string[] {
  return lojas
    .filter((l) => l.taxas > CENTAVO / 2 || l.promocaoLoja > CENTAVO / 2 || l.servicos > CENTAVO / 2)
    .map((l) => `Loja ${l.lojaIdCurto} (${l.competencia}): taxas, promoção ou serviços com sinal positivo. O arquivo parece trocado ou exportado de outro relatório.`);
}

function alertasDoArquivo(lojas: LojaIfoodMes[], obs: Observacoes, estornosSemVenda: number): string[] {
  const alertas: string[] = [];
  for (const [chave, soma] of obs.naoClassificados) {
    alertas.push(`Lançamentos não classificados (${chave}), soma ${brl(soma)}: ficaram fora do líquido. Confira com o portal.`);
  }
  if (obs.parciais.size > 0) {
    alertas.push(`${obs.parciais.size} pedido(s) com cancelamento parcial (valor devolvido ${brl(obs.devolvidoNosParciais)}): o valor do pedido não é reduzido nas vendas. Confira o total com o portal.`);
  }
  if (obs.pedidosSemCesta.size > 0) alertas.push(`${obs.pedidosSemCesta.size} pedido(s) sem valor de venda no arquivo: ficam fora das vendas e da contagem.`);
  if (estornosSemVenda > 0) alertas.push(`${estornosSemVenda} pedido(s) com estorno total sem a venda no arquivo (a venda pode ser de outro mês). Confira.`);
  if (lojas.length === 0) alertas.push("O arquivo não tem nenhum pedido de venda.");
  return alertas;
}

/** Ano-mês da célula de competência: texto "2026-10" ou data (o exceljs devolve Date). */
function competenciaDaCelula(celula: unknown): string {
  if (celula instanceof Date) return Number.isNaN(celula.getTime()) ? "" : celula.toISOString().slice(0, 7);
  return String(celula ?? "").trim().slice(0, 7);
}

export function lerConciliacaoIfood(tabela: unknown[][]): LeituraIfood {
  const vazia = (l: unknown[]) => l.every((c) => String(c ?? "").trim() === "");
  // O cabeçalho é a primeira linha que traz todas as colunas obrigatórias; linhas de título antes dele são ignoradas.
  const reconhece = (l: unknown[]) => { const m = mapearColunas(l); return OBRIGATORIAS.every((k) => m[k] !== undefined); };
  const achado = tabela.findIndex(reconhece);
  const indiceCabecalho = achado >= 0 ? achado : tabela.findIndex((l) => !vazia(l));
  const cabecalho = indiceCabecalho >= 0 ? tabela[indiceCabecalho]! : [];
  const colunas = mapearColunas(cabecalho);
  const faltando = OBRIGATORIAS.filter((k) => colunas[k] === undefined).map((k) => COLUNAS[k][0]);
  if (faltando.length > 0) {
    return { lojas: [], erros: [`Colunas obrigatórias não encontradas: ${faltando.join(", ")}. Use o Relatório de Conciliação do portal do iFood.`], avisos: [], alertas: [] };
  }

  // Guarda o número da linha na planilha (1 = primeira) para o erro apontar a linha certa.
  const corpo = tabela.slice(indiceCabecalho + 1).map((linha, i) => ({ linha, numero: indiceCabecalho + 2 + i })).filter((c) => !vazia(c.linha));
  if (corpo.length > MAX_LINHAS_POR_ARQUIVO) {
    return { lojas: [], erros: [`O arquivo tem mais de ${MAX_LINHAS_POR_ARQUIVO} lançamentos. Envie um mês por vez.`], avisos: [], alertas: [] };
  }

  const grupos = new Map<string, Acumulador>();
  const erros: string[] = [];
  const obs: Observacoes = { pedidosSemCesta: new Set(), parciais: new Set(), devolvidoNosParciais: 0, naoClassificados: new Map() };
  const lojaPorCurto = new Map<string, string>();
  const curtoPorLoja = new Map<string, string>();
  const competencias = new Set<string>();

  for (const { linha, numero } of corpo) {
    const rotulo = `Linha ${numero} da planilha`;
    const competencia = competenciaDaCelula(linha[colunas.competencia!]);
    const lojaId = String(linha[colunas.lojaId!] ?? "").trim();
    const valor = paraNumero(linha[colunas.valor!]);
    if (!competenciaValida(competencia) || !lojaId || valor === null || Math.abs(valor) > VALOR_MAXIMO) {
      erros.push(`${rotulo}: competência (ano-mês entre ${PRIMEIRO_ANO_ACEITO} e hoje), loja ou valor inválido.`);
      continue;
    }
    const curto = colunas.lojaCurto === undefined ? "" : String(linha[colunas.lojaCurto] ?? "").trim();
    if (curto && !/^\d{1,12}$/.test(curto)) {
      erros.push(`${rotulo}: identificador da loja inválido.`);
      continue;
    }
    const efetivo = curto || lojaId;
    if ((lojaPorCurto.has(efetivo) && lojaPorCurto.get(efetivo) !== lojaId) || (curtoPorLoja.has(lojaId) && curtoPorLoja.get(lojaId) !== efetivo)) {
      erros.push(`${rotulo}: o arquivo tem mais de uma loja com o mesmo identificador.`);
      continue;
    }
    lojaPorCurto.set(efetivo, lojaId);
    curtoPorLoja.set(lojaId, efetivo);
    competencias.add(competencia);

    const chave = `${lojaId}|${competencia}`;
    const g = grupos.get(chave) ?? {
      lojaId, lojaIdCurto: efetivo, competencia, cestaPorPedido: new Map(), pedidosComVenda: new Set(), cancelados: new Set(),
      taxas: 0, promocaoLoja: 0, servicos: 0, ajustes: 0, saldoAnterior: 0, semanas: new Map()
    };
    grupos.set(chave, g);

    const l: Lancamento = {
      fato: normalizar(linha[colunas.fato!]), tipo: normalizar(linha[colunas.tipo!]), descricao: normalizar(linha[colunas.descricao!]),
      valor, pedido: String(linha[colunas.pedido!] ?? "").trim()
    };
    classificar(g, l, obs);
    acumularPedido(g, l, paraNumero(linha[colunas.cesta!]), obs);
    acumularSemana(
      g,
      colunas.inicio === undefined ? null : paraDia(linha[colunas.inicio]),
      colunas.fim === undefined ? null : paraDia(linha[colunas.fim]),
      colunas.previsao === undefined ? null : paraDia(linha[colunas.previsao]),
      colunas.transacao === undefined ? null : paraNumero(linha[colunas.transacao])
    );
  }

  if (competencias.size > 1) {
    erros.push(`O arquivo tem mais de uma competência (${[...competencias].sort().join(", ")}). Envie um mês por vez.`);
  }
  if (erros.length > 0) return { lojas: [], erros: limitarErros(erros), avisos: [], alertas: [] };

  // Pedido que tinha a primeira linha sem valor mas outra linha com valor não está sem valor.
  const acumuladores = [...grupos.values()];
  for (const g of acumuladores) for (const p of g.cestaPorPedido.keys()) obs.pedidosSemCesta.delete(p);
  const estornosSemVenda = acumuladores.reduce((n, g) => n + [...g.cancelados].filter((p) => !g.pedidosComVenda.has(p)).length, 0);

  const lojas = acumuladores.map(fecharLoja).sort((a, b) => `${a.competencia}${a.lojaIdCurto}`.localeCompare(`${b.competencia}${b.lojaIdCurto}`));
  const sinais = erroDeSinal(lojas);
  if (sinais.length > 0) return { lojas: [], erros: sinais, avisos: [], alertas: [] };

  const avisos = lojas
    .filter((l) => l.vendas > 0 && l.repasses.length === 0)
    .map((l) => `Loja ${l.lojaIdCurto} (${l.competencia}): nenhum repasse semanal encontrado no arquivo (faltam as colunas de apuração?).`);
  return { lojas, erros: [], avisos, alertas: alertasDoArquivo(lojas, obs, estornosSemVenda) };
}

const iguais = (a: number, b: number) => Math.abs(a - b) < CENTAVO / 2;

/** Cruza cada loja-mês do arquivo com o que já está no razão. Duas linhas ativas no mesmo loja-mês = conflito. */
export function planejarLinhasIfood(lojas: LojaIfoodMes[], existentes: LinhaExistente[]): ItemDoPlanoIfood[] {
  return lojas.map((loja): ItemDoPlanoIfood => {
    const id = `ifood-import-${loja.competencia.replace("-", "")}-${loja.lojaIdCurto}`;
    const doMes = existentes.filter((e) => e.loja === loja.lojaIdCurto && e.competencia === loja.competencia);
    if (doMes.length === 0) return { loja, id, acao: "CRIAR", existenteId: null, anterior: null };
    if (doMes.length > 1) return { loja, id, acao: "CONFLITO", existenteId: null, anterior: null };
    const atual = doMes[0]!;
    const igual = atual.orders === loja.pedidos && iguais(atual.grossAmount, loja.bruto) && iguais(atual.netAmount, loja.liquido);
    const anterior = { pedidos: atual.orders, bruto: atual.grossAmount, liquido: atual.netAmount };
    return { loja, id: atual.id, acao: igual ? "IGUAL" : "ALTERAR", existenteId: atual.id, anterior };
  });
}
