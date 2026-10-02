// Mensagem depois de fechar a gorjeta. O fechamento já está gravado; a atualização dos
// salários combinados e os acertos da lista de pagamento no Contas a Pagar vêm junto e, se não
// foram feitos (falta de permissão da Folha, mês travado…), viram aviso — nunca erro do fechamento.
import type { AcertosAposFechar, SincronizacaoAposFechar } from "../../api/client";
import type { NoticeState } from "../../components/Notice";

const BASE = "Período fechado. O retrato completo ficou gravado no registro de fechamentos (Relatórios → Fechamentos).";

const comTexto = (lista: Array<string | null | undefined>) => lista.filter((t): t is string => Boolean(t && t.trim()));
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function partesDosAcertos(a: AcertosAposFechar | null | undefined) {
  if (!a) return { feito: null, problemas: [] as string[] };
  const contas = [a.criados > 0 ? plural(a.criados, "lançado", "lançados") : null, a.atualizados > 0 ? plural(a.atualizados, "atualizado", "atualizados") : null];
  const feitos = comTexto(contas);
  return {
    feito: feitos.length ? `Acertos da lista no Contas a Pagar: ${feitos.join(", ")}.` : null,
    problemas: comTexto([a.aviso, a.erro, ...(a.avisos ?? [])]),
  };
}

export function avisoDoFechamento(r: { salariosCombinados?: SincronizacaoAposFechar | null; acertosLista?: AcertosAposFechar | null }): NoticeState {
  const s = r.salariosCombinados;
  const problemasSalario = comTexto([s?.aviso, s?.erro, ...(s?.detalhes?.avisos ?? [])]);
  const n = s?.atualizados ?? 0;
  const feitoSalario = problemasSalario.length === 0 && n > 0
    ? `${plural(n, "salário combinado atualizado", "salários combinados atualizados")} no Contas a Pagar.` : null;
  const acertos = partesDosAcertos(r.acertosLista);
  const atencao = [
    problemasSalario.length ? `Atenção — salários combinados: ${problemasSalario.join("; ")}.` : null,
    acertos.problemas.length ? `Atenção — acertos da lista: ${acertos.problemas.join("; ")}.` : null,
  ];
  const texto = [BASE, feitoSalario, acertos.feito, ...atencao].filter(Boolean).join(" ").replace(/\.\./g, ".");
  const temProblema = problemasSalario.length > 0 || acertos.problemas.length > 0;
  return { tone: temProblema ? "warning" : "success", message: texto };
}
