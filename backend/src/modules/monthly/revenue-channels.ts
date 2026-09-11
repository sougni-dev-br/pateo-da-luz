/**
 * Nomes canonicos dos canais de faturamento, gravados na coluna RevenueEntry.channel.
 *
 * Existiam como literal solto em 4 arquivos e as grafias divergiram: o "Fechar o dia"
 * comparava com "Salao" (sem acento) enquanto o dado real e "Salão", entao recusava todo
 * dia com "Salao pendente". Centralizado aqui para que a comparacao nao possa mais divergir
 * da escrita.
 */
export const REVENUE_CHANNEL_SALON = "Salão";
export const REVENUE_CHANNEL_DELIVERY = "Delivery";

/**
 * Nomes canonicos das plataformas, gravados em RevenueEntry.sourcePlatform.
 *
 * Mesmo problema dos canais, um nivel acima: a MESMA plataforma e gravada com dois
 * rotulos diferentes conforme a origem do lancamento. A importacao por planilha grava
 * "99Food" e "iFood"; as integracoes gravam "NOVENTA_NOVE" e "IFOOD".
 *
 * O relatorio de faturamento agrupa por esse campo, entao a mesma plataforma aparecia
 * em DUAS linhas na tela de Faturamento. Medido em producao em 11/09/2026:
 *
 *   "99Food"        planilha     abr-mai   R$ 143.745,84
 *   "NOVENTA_NOVE"  integracao   ago-set   R$  31.548,50
 *   "iFood"         planilha     abr-mai   R$  32.557,16
 *
 * normalizePlatform() existe para que a EXIBICAO nao dependa de qual caminho gravou.
 * Os dados nao sao alterados: o rotulo bruto continua guardado e diz de onde veio.
 */
const PLATAFORMA_CANONICA: Record<string, string> = {
  NOVENTA_NOVE: "99Food",
  "99FOOD": "99Food",
  IFOOD: "iFood",
  KEETA: "Keeta",
  AGILE_PDV: "Agile PDV",
};

export const PLATAFORMA_SEM_ORIGEM = "Sem plataforma";

export function normalizePlatform(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return PLATAFORMA_SEM_ORIGEM;
  return PLATAFORMA_CANONICA[v.toUpperCase()] ?? v;
}
