// "Aviso e Recibo de Férias" que a contabilidade devolve depois de receber a programação.
// Lê o texto do PDF (como o pdf-parse entrega: os valores da tabela vêm soltos dos rótulos, então
// só se confia no que tem rótulo próprio: período, datas, totais e o "importância líquida de R$").
// Nada de CPF, carteira profissional nem salário-base sai daqui: só o que o Contas a Pagar precisa.

export type ReciboDeFerias = {
  nome: string | null;
  empresa: string | null;
  aquisitivoInicio: string | null;
  aquisitivoFim: string | null;
  gozoInicio: string | null;
  gozoFim: string | null;
  dias: number | null;
  /** O recibo traz mais de dois períodos (abono ou licença remunerada): o valor merece conferência. */
  temOutroPeriodo: boolean;
  /** Data do aviso (1ª "Data:") e do recibo, que é a do pagamento (2ª "Data:"). */
  avisoEm: string | null;
  pagamentoEm: string | null;
  proventos: number | null;
  descontos: number | null;
  liquido: number | null;
};

const BR = String.raw`(\d{2})\/(\d{2})\/(\d{4})`;
const iso = (d: string, m: string, a: string) => `${a}-${m}-${d}`;
const dinheiro = (t: string | undefined): number | null => {
  if (!t) return null;
  const n = Number(t.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const VALOR = String.raw`([\d.]+,\d{2})`;
const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const juntaEspacos = (t: string) => t.replace(/\s+/g, " ").trim();

export const ehReciboDeFerias = (texto: string): boolean => /AVISO\s+E\s+RECIBO\s+DE\s+F[ÉE]RIAS/i.test(texto);

function lerNome(linhas: string[], empresa: string | null): string | null {
  // A assinatura traz "NOME EMPRESA" na mesma linha; tira a empresa e sobra o nome.
  if (empresa) {
    const alvo = semAcento(empresa);
    for (const l of linhas) {
      const limpa = juntaEspacos(l);
      if (semAcento(limpa).length > alvo.length && semAcento(limpa).endsWith(alvo)) {
        const nome = limpa.slice(0, limpa.length - empresa.length).trim();
        if (nome.split(" ").length >= 2) return nome;
      }
    }
  }
  // Senão, a linha só de letras maiúsculas que mais se repete (a assinatura do recibo e a do aviso).
  const contagem = new Map<string, number>();
  for (const l of linhas) {
    const t = juntaEspacos(l);
    if (/^[A-ZÀ-Ý]{2,}( [A-ZÀ-Ý]{2,})+$/.test(t) && !/AVISO|RECIBO|F[ÉE]RIAS|NOTIFICA|PER[ÍI]ODOS|BASE|PROVENTOS|LICEN/.test(t)) {
      contagem.set(t, (contagem.get(t) ?? 0) + 1);
    }
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function lerReciboDeFerias(texto: string): ReciboDeFerias {
  const linhas = texto.split(/\r?\n/);
  const empresa = /Recebi da firma\s+(.+?),\s*estabelecida/i.exec(texto)?.[1]?.replace(/\s+/g, " ").trim() ?? null;

  // "01/02/2025 A 31/01/2026 02/12/2026 A 31/12/2026 = 30 Dias" (aquisição, gozo e dias)
  const periodos = new RegExp(`${BR}\\s+A\\s+${BR}\\s+${BR}\\s+A\\s+${BR}\\s*=\\s*(\\d+)\\s*Dias`, "i").exec(texto);
  const linhaDosPeriodos = linhas.find((l) => /=\s*\d+\s*Dias/i.test(l)) ?? "";
  const intervalos = linhaDosPeriodos.match(new RegExp(`${BR}\\s+A\\s+${BR}`, "gi")) ?? [];

  const datas = [...texto.matchAll(new RegExp(String.raw`Data:\s*${BR}`, "gi"))].map((m) => iso(m[1], m[2], m[3]));
  const liquidoRotulo = dinheiro(new RegExp(String.raw`TOTAL\s+L[ÍI]QUIDO:\s*${VALOR}`, "i").exec(texto)?.[1]);
  const liquidoFrase = dinheiro(new RegExp(String.raw`import[âa]ncia l[íi]quida de R\$\s*${VALOR}`, "i").exec(texto)?.[1]);

  return {
    nome: lerNome(linhas, empresa),
    empresa,
    aquisitivoInicio: periodos ? iso(periodos[1], periodos[2], periodos[3]) : null,
    aquisitivoFim: periodos ? iso(periodos[4], periodos[5], periodos[6]) : null,
    gozoInicio: periodos ? iso(periodos[7], periodos[8], periodos[9]) : null,
    gozoFim: periodos ? iso(periodos[10], periodos[11], periodos[12]) : null,
    dias: periodos ? Number(periodos[13]) : null,
    temOutroPeriodo: intervalos.length > 2,
    avisoEm: datas[0] ?? null,
    pagamentoEm: datas[1] ?? datas[0] ?? null,
    proventos: dinheiro(new RegExp(String.raw`TOTAL\s+DOS\s+PROVENTOS:\s*${VALOR}`, "i").exec(texto)?.[1]),
    descontos: dinheiro(new RegExp(String.raw`TOTAL\s+DOS\s+DESCONTOS:\s*${VALOR}`, "i").exec(texto)?.[1]),
    // O rótulo manda; sem ele, vale a frase do aviso.
    liquido: liquidoRotulo ?? liquidoFrase,
  };
}

export type AvaliacaoDoRecibo = { recusa: string | null; avisos: string[] };

/** O que está errado ou merece conferência só pelo recibo (sem olhar o cadastro nem o ERP). */
export function avaliarRecibo(r: ReciboDeFerias, textoOriginal?: string): AvaliacaoDoRecibo {
  const avisos: string[] = [];
  if (!r.nome) return { recusa: "Não achei o nome do empregado no recibo.", avisos };
  if (!r.gozoInicio || !r.gozoFim || !r.dias) return { recusa: "Não achei o período de gozo das férias no recibo.", avisos };
  if (!r.liquido || r.liquido <= 0) return { recusa: "Não achei o valor líquido das férias no recibo.", avisos };
  if (r.gozoFim < r.gozoInicio) return { recusa: "O período de gozo do recibo termina antes de começar.", avisos };
  const frase = textoOriginal ? dinheiro(new RegExp(String.raw`import[âa]ncia l[íi]quida de R\$\s*${VALOR}`, "i").exec(textoOriginal)?.[1]) : null;
  if (frase != null && Math.abs(frase - r.liquido) > 0.004) avisos.push(`O líquido da tabela (R$ ${r.liquido.toFixed(2)}) difere do da frase do aviso (R$ ${frase.toFixed(2)}).`);
  if (r.proventos != null && r.descontos != null && Math.abs(r.proventos - r.descontos - r.liquido) > 0.01) {
    avisos.push("Proventos menos descontos não fecham com o líquido do recibo: confira o PDF.");
  }
  if (r.temOutroPeriodo) avisos.push("O recibo traz mais de dois períodos (abono ou licença remunerada): confira se o valor líquido inclui tudo.");
  if (!r.pagamentoEm) avisos.push("O recibo não traz a data do pagamento: o vencimento será 2 dias antes do início das férias.");
  return { recusa: null, avisos };
}
