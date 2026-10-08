import type { OperationalInventory } from "../../../api/client";

// Regras da lista de inventarios. Ficam fora do componente para dar teste.

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

// Rascunho sem nenhuma quantidade, criado ha mais que isso, so ocupa a lista.
const DIAS_PARA_RASCUNHO_ABANDONADO = 30;
const UM_DIA_MS = 86_400_000;

/** Data que conta para o mes: a efetiva, se houver; senao a de referencia. */
export function dataDoInventario(inventario: OperationalInventory): string {
  return inventario.effectiveCountDate ?? inventario.date;
}

/**
 * O nome gravado repete o que as outras colunas ja dizem:
 * "Inventario 13/08/2026 - gerado da contagem CNT-2026-0076". Fica o que sobra.
 */
export function tituloCurto(inventario: OperationalInventory): string {
  // O Final CMV e o fechamento de um mes: o nome dele e o mes.
  if (inventario.type === "FINAL_CMV") {
    const iso = dataDoInventario(inventario);
    if (iso) {
      const [ano, mes] = iso.slice(0, 7).split("-").map(Number);
      return `Fechamento de ${MESES[mes - 1].toLowerCase()} de ${ano}`;
    }
  }
  const nome = inventario.name.trim();
  const semPrefixo = nome.replace(/^invent[aá]rio\s+(final\s+cmv\s+)?\d{2}\/\d{2}\/\d{4}\s*-\s*/i, "").trim();
  if (!semPrefixo) return nome;
  return semPrefixo.charAt(0).toUpperCase() + semPrefixo.slice(1);
}

export type GrupoDoMes = {
  chave: string;
  rotulo: string;
  inventarios: OperationalInventory[];
};

export function agruparPorMes(inventarios: readonly OperationalInventory[]): GrupoDoMes[] {
  const grupos = new Map<string, GrupoDoMes>();
  for (const inventario of inventarios) {
    const iso = dataDoInventario(inventario);
    const chave = iso ? iso.slice(0, 7) : "sem-data";
    if (!grupos.has(chave)) {
      const [ano, mes] = chave.split("-").map(Number);
      const rotulo = chave === "sem-data" ? "Sem data" : `${MESES[mes - 1]} de ${ano}`;
      grupos.set(chave, { chave, rotulo, inventarios: [] });
    }
    grupos.get(chave)!.inventarios.push(inventario);
  }
  return [...grupos.values()]
    .sort((a, b) => b.chave.localeCompare(a.chave))
    .map((grupo) => ({
      ...grupo,
      inventarios: [...grupo.inventarios].sort((a, b) => dataDoInventario(b).localeCompare(dataDoInventario(a)))
    }));
}

export function rascunhosVazios(inventarios: readonly OperationalInventory[], hoje: Date): OperationalInventory[] {
  const limite = hoje.getTime() - DIAS_PARA_RASCUNHO_ABANDONADO * UM_DIA_MS;
  return inventarios.filter((inventario) =>
    inventario.status === "RASCUNHO"
    && Number(inventario.countedItems) === 0
    && new Date(inventario.date).getTime() < limite
  );
}

export const STATUS_EM_ANDAMENTO = new Set(["RASCUNHO", "EM_REVISAO", "REJEITADO"]);

export type TomDoPasso = "acao" | "atencao" | "espera" | "ok" | "neutro";

/** O que falta para o inventario andar, em uma frase. */
export function proximoPasso(inventario: OperationalInventory): { texto: string; tom: TomDoPasso } {
  switch (inventario.status) {
    case "RASCUNHO": {
      const faltam = Number(inventario.pendingItems);
      return faltam > 0
        ? { texto: `Faltam ${faltam} ${faltam === 1 ? "item" : "itens"}`, tom: "atencao" }
        : { texto: "Pronto para enviar à revisão", tom: "acao" };
    }
    case "EM_REVISAO": return { texto: "Aguardando aprovação", tom: "espera" };
    case "REJEITADO": return { texto: "Devolvido: corrigir e reenviar", tom: "atencao" };
    case "APROVADO": return { texto: "Aprovado, falta fechar", tom: "acao" };
    case "FECHADO": return { texto: "Fechado", tom: "ok" };
    default: return { texto: "Cancelado", tom: "neutro" };
  }
}

export type Situacao = {
  /** Final CMV aprovado ou fechado mais recente: o que o CMV esta usando. */
  ultimoFechamento: OperationalInventory | null;
  emAndamento: number;
  emRevisao: number;
};

export function situacao(inventarios: readonly OperationalInventory[]): Situacao {
  const fechamentos = inventarios
    .filter((i) => i.type === "FINAL_CMV" && (i.status === "APROVADO" || i.status === "FECHADO"))
    .sort((a, b) => dataDoInventario(b).localeCompare(dataDoInventario(a)));
  return {
    ultimoFechamento: fechamentos[0] ?? null,
    emAndamento: inventarios.filter((i) => STATUS_EM_ANDAMENTO.has(i.status)).length,
    emRevisao: inventarios.filter((i) => i.status === "EM_REVISAO").length
  };
}
