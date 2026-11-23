/**
 * Lê a aba "Base mensal" da planilha de planejamento (uma linha por ano/mês, a partir do fechamento de caixa).
 * Colunas: Ano, Mês, Vendas almoço, Vendas jantar, Vendas mesas, TC almoço, TC jantar, TC total,
 * Serviço Doceira, Arquivo de origem. Linha sem venda (mês "Ainda não fechado") é ignorada.
 */

export type LinhaDoHistorico = {
  ano: number;
  mes: number;
  vendasAlmoco: number;
  vendasJantar: number;
  clientesAlmoco: number;
  clientesJantar: number;
  servico: number;
  fonte: string | null;
};

export type ResultadoDaLeitura = { linhas: LinhaDoHistorico[]; avisos: string[] };

type Celula = string | number | null | undefined;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const TOLERANCIA_REAIS = 0.05;

const numero = (c: Celula): number | null => {
  if (c === null || c === undefined || c === "") return null;
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const texto = String(c).trim();
  // "1234.56" é ponto decimal (não milhar); "1.234,56" e "1.234" seguem o formato pt-BR.
  const pontoDecimal = /^-?\d+\.\d{1,2}$/.test(texto) || /^-?\d+\.\d{4,}$/.test(texto);
  const n = Number(pontoDecimal ? texto : texto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

export function lerBaseMensal(linhas: readonly (readonly Celula[])[]): ResultadoDaLeitura {
  const resultado: LinhaDoHistorico[] = [];
  const avisos: string[] = [];

  linhas.forEach((cel, i) => {
    const numeroDaLinha = i + 1;
    const ano = numero(cel[0]);
    if (ano === null || ano < 2000) return; // cabeçalho ou linha em branco
    const mes = MESES.indexOf(semAcento(String(cel[1] ?? "")).slice(0, 3)) + 1;
    if (mes < 1) {
      avisos.push(`Linha ${numeroDaLinha}: mês "${cel[1]}" não reconhecido; ignorada.`);
      return;
    }
    const almoco = numero(cel[2]);
    const jantar = numero(cel[3]);
    const clientesAlmoco = numero(cel[5]);
    const clientesJantar = numero(cel[6]);
    if (almoco === null && jantar === null) return; // mês ainda não fechado

    if (almoco === null || jantar === null || clientesAlmoco === null || clientesJantar === null) {
      avisos.push(`Linha ${numeroDaLinha} (${mes}/${ano}): faltam vendas ou clientes de um dos turnos; ignorada.`);
      return;
    }
    if (almoco < 0 || jantar < 0 || clientesAlmoco < 0 || clientesJantar < 0) {
      avisos.push(`Linha ${numeroDaLinha} (${mes}/${ano}): valor negativo; ignorada.`);
      return;
    }

    const mesas = numero(cel[4]);
    if (mesas !== null && Math.abs(mesas - (almoco + jantar)) > TOLERANCIA_REAIS) {
      avisos.push(`${mes}/${ano}: a coluna Mesas (${mesas}) não fecha com almoço + jantar (${(almoco + jantar).toFixed(2)}); usei almoço e jantar.`);
    }
    const tcTotal = numero(cel[7]);
    if (tcTotal !== null && tcTotal !== clientesAlmoco + clientesJantar) {
      avisos.push(`${mes}/${ano}: TC total (${tcTotal}) difere da soma dos turnos (${clientesAlmoco + clientesJantar}); usei a soma dos turnos.`);
    }

    resultado.push({
      ano,
      mes,
      vendasAlmoco: almoco,
      vendasJantar: jantar,
      clientesAlmoco,
      clientesJantar,
      servico: numero(cel[8]) ?? 0,
      fonte: cel[9] ? String(cel[9]).trim().slice(0, 120) : null
    });
  });

  return { linhas: resultado, avisos };
}
