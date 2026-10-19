// Regras puras do agente da Keeta: nada de rede nem de navegador aqui, para poderem ser testadas.
//
// O protocolo do portal (descoberto em 19/10/2026, merchant.mykeeta.com):
//   1. POST /api/operate/data/download/task/create   pede o relatório "Dados do restaurante"
//   2. POST /api/operate/data/download/record/page   lista os relatórios; o pronto tem taskStatus 2 e s3Url
//   3. GET  <s3Url>                                  baixa o .xlsx (o mesmo formato que o ERP já importa)

const MEDIDAS = [
  "shop_income_no_low_price", // Vendas de itens
  "shop_shop_activity_subsidy_amt", // Despesa (promoção paga pela loja)
  "shop_profit_general", // Ganhos líquidos (repasse)
  "shop_valid_order_num" // Pedidos válidos
];

const STATUS_PRONTO = 2;
/** Folga entre o relógio do portal e o da máquina ao decidir se um relatório é "novo". */
const FOLGA_DO_RELOGIO_MS = 60_000;
/** Nos primeiros dias do mês a Keeta ainda ajusta o mês anterior: ele entra na sincronização. */
const DIAS_DE_FOLGA_DO_MES_ANTERIOR = 5;

/** Cabeçalhos do próprio app do portal que as chamadas de API exigem (grafia original). */
const CABECALHOS_DO_APP = [
  "M-TRACEID", "M-APPKEY", "accountId", "shopId", "appVersion", "platform", "clientType", "uuid",
  "locale", "sysLocale", "region", "timeZone", "cityId", "bizLine", "Accept", "Content-Type"
];

const doisDigitos = (n) => String(n).padStart(2, "0");
const ymd = (ano, mes, dia) => `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
const compacto = (iso) => iso.replaceAll("-", "");

function ontem(hoje) {
  const [a, m, d] = hoje.split("-").map(Number);
  const dia = new Date(Date.UTC(a, m - 1, d - 1));
  return ymd(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate());
}

/** Do dia 1 até o último dia do mês, ou até ontem se o mês ainda não acabou. null se não há dia fechado. */
export function periodoDoMes(ano, mes, hoje) {
  const inicio = ymd(ano, mes, 1);
  const ultimoDoMes = ymd(ano, mes, new Date(Date.UTC(ano, mes, 0)).getUTCDate());
  const limite = ontem(hoje);
  const fim = ultimoDoMes < limite ? ultimoDoMes : limite;
  return inicio > fim ? null : { inicio, fim };
}

export function mesesParaSincronizar(hoje) {
  const [ano, mes, dia] = hoje.split("-").map(Number);
  const atual = { ano, mes };
  if (dia > DIAS_DE_FOLGA_DO_MES_ANTERIOR) return [atual];
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  return [anterior, atual];
}

export function corpoDaExportacao({ shopId, inicio, fim }) {
  return {
    form: {
      measures: [...MEDIDAS],
      dateFilters: [{ code: "dt", values: [`${compacto(inicio)}~${compacto(fim)}`] }],
      filters: [[{ code: "shop_id", values: [shopId] }]],
      groupBy: ["shop_id"]
    },
    code: "shop_download_center_table",
    ext: { locale: "pt-BR" },
    downloadType: 1,
    reportTab: "Dados do restaurante",
    downloadCategory: 1
  };
}

export function prefixoDoArquivo(inicio, fim) {
  return `Dados_do_restaurante_${compacto(inicio)}~${compacto(fim)}_`;
}

/**
 * Entre os relatórios listados pelo portal, o PRONTO do período pedido e criado depois do pedido atual.
 * Sem o filtro de data, um relatório velho do mesmo período seria baixado no lugar do novo.
 */
export function escolherRegistro(registros, { inicio, fim, depoisDe }) {
  const prefixo = prefixoDoArquivo(inicio, fim);
  const candidatos = registros.filter(
    (r) =>
      r.taskStatus === STATUS_PRONTO
      && Boolean(r.s3Url)
      && String(r.fileName ?? "").startsWith(prefixo)
      && Number(r.ctime) >= depoisDe - FOLGA_DO_RELOGIO_MS
  );
  if (candidatos.length === 0) return null;
  return candidatos.reduce((melhor, r) => (Number(r.ctime) > Number(melhor.ctime) ? r : melhor));
}

/** Playwright entrega os cabeçalhos em minúsculas; só os do app voltam, e nunca cookie nem user-agent. */
export function cabecalhosParaReusar(capturados) {
  const porMinuscula = new Map(Object.entries(capturados).map(([k, v]) => [k.toLowerCase(), v]));
  const resultado = {};
  for (const nome of CABECALHOS_DO_APP) {
    const valor = porMinuscula.get(nome.toLowerCase());
    if (valor !== undefined) resultado[nome] = valor;
  }
  return resultado;
}

export function ehPaginaDeLogin(url) {
  return String(url).includes("/pc/login");
}
