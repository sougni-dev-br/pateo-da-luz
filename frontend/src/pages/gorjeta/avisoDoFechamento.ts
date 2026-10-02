// Mensagem depois de fechar a gorjeta. O fechamento já está gravado; a atualização dos
// salários combinados no Contas a Pagar vem junto e, se não foi feita (falta de permissão
// da Folha, mês travado…), vira aviso — nunca erro do fechamento.
import type { SincronizacaoAposFechar } from "../../api/client";
import type { NoticeState } from "../../components/Notice";

const BASE = "Período fechado. O retrato completo ficou gravado no registro de fechamentos (Relatórios → Fechamentos).";

export function avisoDoFechamento(r: { salariosCombinados?: SincronizacaoAposFechar | null }): NoticeState {
  const s = r.salariosCombinados;
  const problemas = [s?.aviso, s?.erro, ...(s?.detalhes?.avisos ?? [])].filter((t): t is string => Boolean(t && t.trim()));
  if (problemas.length > 0) {
    return { tone: "warning", message: `${BASE} Atenção — salários combinados: ${problemas.join("; ")}.`.replace(/\.\.$/, ".") };
  }
  const n = s?.atualizados ?? 0;
  if (n > 0) {
    return { tone: "success", message: `${BASE} ${n} ${n === 1 ? "salário combinado atualizado" : "salários combinados atualizados"} no Contas a Pagar.` };
  }
  return { tone: "success", message: BASE };
}
