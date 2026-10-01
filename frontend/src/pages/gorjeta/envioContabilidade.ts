import type { TipComputation, TipComputedParticipant } from "../../api/client";

// Envio à contabilidade: só quem é registrado, por empresa e depois por nome. Os sem
// registro vão para a lista de pagamento; quem recebeu a gorjeta na rescisão não entra de
// novo; quem está só pelo salário não tem gorjeta a lançar.
//
// A gorjeta enviada é a INFORMADA: com teto do IR (CLT), teto − salário registrado do mês
// (a pessoa continua recebendo a gorjeta real na lista de pagamento); sem teto, a líquida.

/** Gorjeta que vai à contabilidade. null = pelo teto sem permissão de ver Funcionários (o valor revelaria o salário). */
export function gorjetaEnviada(p: TipComputedParticipant): number | null {
  if (p.gorjetaInformada !== undefined && p.gorjetaInformada !== null) return p.gorjetaInformada;
  return p.gorjetaInformadaPeloTeto ? null : p.netCommission;
}

export const vaiAContabilidade = (p: TipComputedParticipant) =>
  p.tipoCalculo !== "FORA_DO_PERIODO" && !p.semRegistro && !p.pagoNaRescisao && !p.foraDaGorjeta;

export const empresaDoEnvio = (p: TipComputedParticipant) => p.companyName || "Sem empresa";

export const NOTA_TETO_OCULTO =
  "Gorjeta informada pelo teto do IR (teto − salário registrado): exige permissão de ver Funcionários.";

export type LinhaEnvio = { pessoa: TipComputedParticipant; empresa: string; gorjeta: number | null; peloTeto: boolean };

/** Linhas do envio e o total. Com alguém pelo teto sem permissão, o total é null (seria parcial). */
export function montarEnvioContabilidade(comp: TipComputation): { linhas: LinhaEnvio[]; total: number | null; ocultos: number } {
  const linhas = comp.participants
    .filter(vaiAContabilidade)
    .map((p) => ({ pessoa: p, empresa: empresaDoEnvio(p), gorjeta: gorjetaEnviada(p), peloTeto: Boolean(p.gorjetaInformadaPeloTeto) }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, "pt-BR") || a.pessoa.employeeName.localeCompare(b.pessoa.employeeName, "pt-BR"));
  const ocultos = linhas.filter((l) => l.gorjeta == null).length;
  const total = ocultos ? null : Math.round(linhas.reduce((a, l) => a + (l.gorjeta ?? 0), 0) * 100) / 100;
  return { linhas, total, ocultos };
}
