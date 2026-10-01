// Situação de cada rescisão na lista de RH → Rescisões e o próximo passo de quem cuida.
import type { RescisaoResumo } from "../../../api/client";

export type Situacao = "FALTA_LANCAR" | "TERMO_IMPORTADO" | "LANCADA" | "PAGA_EM_PARTE" | "PAGA" | "QUITADA_NO_TERMO" | "QUITADA";
export type TomSituacao = "warning" | "info" | "success" | "neutral";

export type SituacaoRescisao = {
  situacao: Situacao;
  rotulo: string;
  tom: TomSituacao;
  proximoPasso: string;
  /** Saída marcada para depois de hoje. */
  saindo: boolean;
};

const ROTULO: Record<Situacao, string> = {
  FALTA_LANCAR: "Falta lançar",
  TERMO_IMPORTADO: "Termo importado",
  LANCADA: "Lançada",
  PAGA_EM_PARTE: "Paga em parte",
  PAGA: "Paga",
  QUITADA_NO_TERMO: "Quitada no termo",
  QUITADA: "Quitada",
};
const TOM: Record<Situacao, TomSituacao> = {
  FALTA_LANCAR: "warning",
  TERMO_IMPORTADO: "info",
  LANCADA: "info",
  PAGA_EM_PARTE: "warning",
  PAGA: "success",
  QUITADA_NO_TERMO: "success",
  QUITADA: "success",
};

const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const IMPORTAR_TERMO = "Importar o termo (TRCT) na gorjeta do mês da saída";

type Entrada = Pick<RescisaoResumo, "semRegistro" | "saida" | "rescisao" | "termo">;

function proximoPasso(situacao: Situacao, r: Entrada): string {
  const clt = !r.semRegistro;
  switch (situacao) {
    case "FALTA_LANCAR":
      if (!r.saida) return "Registrar a data de saída";
      return clt ? "Aguardar o termo (TRCT) da contabilidade e importar" : "Conferir a apuração e lançar";
    case "TERMO_IMPORTADO":
      return "Lançar a rescisão com o bruto do termo";
    case "LANCADA":
      return clt && !r.termo ? IMPORTAR_TERMO : "Pagar em Contas a Pagar";
    case "PAGA_EM_PARTE": {
      const faltam = (r.rescisao?.parcelas ?? 0) - (r.rescisao?.pagas ?? 0);
      return `Pagar as parcelas restantes (${faltam} de ${r.rescisao?.parcelas ?? 0})`;
    }
    case "PAGA":
      return clt && !r.termo ? IMPORTAR_TERMO : "Concluída";
    case "QUITADA_NO_TERMO":
      return "Concluída — nada a pagar (líquido zero no termo)";
    case "QUITADA": {
      const perdoado = r.rescisao?.quitadaSemValor?.saldoDevedorPerdoado ?? 0;
      return perdoado > 0 ? `Concluída — saldo devedor de ${reais(perdoado)} perdoado` : "Concluída — nada a pagar";
    }
  }
}

export function situacaoRescisao(r: Entrada, hojeIso: string): SituacaoRescisao {
  const l = r.rescisao;
  const situacao: Situacao = !l
    ? (!r.semRegistro && r.termo ? "TERMO_IMPORTADO" : "FALTA_LANCAR")
    : l.quitadaNoTermo ? "QUITADA_NO_TERMO"
      : l.quitadaSemValor ? "QUITADA"
      : l.pagas >= l.parcelas ? "PAGA"
        : l.pagas > 0 ? "PAGA_EM_PARTE"
          : "LANCADA";
  const saindo = r.saida != null && r.saida > hojeIso;
  const passo = proximoPasso(situacao, r);
  return {
    situacao,
    rotulo: ROTULO[situacao],
    tom: TOM[situacao],
    proximoPasso: saindo && situacao === "FALTA_LANCAR" ? `Sai em ${diaMes(r.saida!)}: ${passo.charAt(0).toLowerCase()}${passo.slice(1)}` : passo,
    saindo,
  };
}
