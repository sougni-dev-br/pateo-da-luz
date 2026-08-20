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
