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

export type GrupoEnvio = { companyId: string | null; empresa: string; linhas: LinhaEnvio[]; subtotal: number };

/** Linhas do envio separadas por empresa (na ordem do envio), com o subtotal de cada uma. */
export function agruparEnvioPorEmpresa(linhas: LinhaEnvio[]): GrupoEnvio[] {
  const grupos: GrupoEnvio[] = [];
  for (const l of linhas) {
    let g = grupos.find((x) => x.empresa === l.empresa);
    if (!g) { g = { companyId: l.pessoa.companyId, empresa: l.empresa, linhas: [], subtotal: 0 }; grupos.push(g); }
    g.linhas.push(l);
    g.subtotal = Math.round((g.subtotal + (l.gorjeta ?? 0)) * 100) / 100;
  }
  return grupos;
}

// A fonte padrão do PDF (Helvetica, WinAnsi) não tem o sinal de menos "−" nem alguns traços:
// eles saem embaralhados. Tudo que vai para o PDF passa por aqui.
export function textoPdf(s: string): string {
  return s.replace(/−/g, "-").replace(/[‐-–]/g, "-").replace(/ /g, " ");
}

const PARTICULAS = new Set(["da", "de", "di", "do", "du", "das", "dos", "e"]);

/** Nome no envio como nome próprio ("Maria Jose Silva de Freitas"), venha em maiúsculas ou não. */
export const nomeNoEnvio = (nome: string) =>
  textoPdf(nome.trim().toLocaleLowerCase("pt-BR").split(/\s+/)
    .map((p, i) => (i > 0 && PARTICULAS.has(p) ? p : p.charAt(0).toLocaleUpperCase("pt-BR") + p.slice(1)))
    .join(" "));

/** Célula de quantidade (horas h:mm ou dias): vazio vira traço discreto. */
export const celulaOuTraco = (v: string | number | null | undefined) =>
  v == null || v === "" || v === 0 ? "-" : textoPdf(String(v));

/** Totais do resumo do envio: horas extras e noturnas somadas (minutos), faltas e atestados (dias). */
export function totaisDoEnvio(linhas: LinhaEnvio[], minutos: (t: string | null | undefined) => number | null) {
  const soma = (f: (l: LinhaEnvio) => number) => linhas.reduce((a, l) => a + f(l), 0);
  return {
    minutosHoraExtra: soma((l) => Math.max(0, minutos(l.pessoa.horaExtra) ?? 0)),
    minutosNoturno: soma((l) => Math.max(0, minutos(l.pessoa.adicionalNoturno) ?? 0)),
    faltas: soma((l) => l.pessoa.faltas ?? 0),
    atestados: soma((l) => l.pessoa.atestados ?? 0),
  };
}

/** Na impressão não entra quem tem gorjeta zero e nada mais a pagar (hora extra ou noturno mantêm a linha). */
export const entraNaImpressao = (l: LinhaEnvio, minutos: (t: string | null | undefined) => number | null) =>
  (l.gorjeta ?? 0) > 0 || (minutos(l.pessoa.horaExtra) ?? 0) > 0 || (minutos(l.pessoa.adicionalNoturno) ?? 0) > 0;
