// Regras da importação da ficha de registro para o cadastro — puras, sem banco.
//
// A ficha é o documento da contabilidade, mas o cadastro do ERP pode ter sido corrigido à mão
// (a ficha da Michele diz "Masculino"; a da Maria Rosana traz os filhos como pai e mãe). Por
// isso só se PREENCHE o que está vazio; valor diferente já gravado vira aviso, nunca é trocado.
// Salário, cargo, vínculo, empresa, admissão e turno não são tocados: entram no histórico do
// cadastro (EmployeeHistorico) e mexer neles muda cálculo de mês passado. O histórico da
// carteira vai para tabela própria (EmployeeAnotacaoCarteira), que só é consultada.

import type { FichaFerias, FichaRegistro } from "./ficha-registro-parser.js";
import { cidadeProprio, nomeProprio } from "../../shared/utils/nome-proprio.js";

export const ORIGEM_FICHA = "FICHA_REGISTRO";

// Campos novos do Employee que vêm só da ficha.
export type CamposFicha = {
  nomeCompleto: string | null; registroNumero: string | null; matriculaEsocial: string | null;
  nomeMae: string | null; nomePai: string | null;
  estadoCivil: string | null; nacionalidade: string | null; naturalidade: string | null;
  racaCor: string | null; escolaridade: string | null; possuiDeficiencia: boolean | null;
  rgDataEmissao: Date | null; rgOrgaoEmissor: string | null;
  tituloEleitor: string | null; tituloZona: string | null; tituloSecao: string | null;
  ctpsNumero: string | null; ctpsSerie: string | null; ctpsUf: string | null; ctpsDataEmissao: Date | null;
  cbo: string | null;
  jornadaInicio: string | null; jornadaFim: string | null; intervaloInicio: string | null; intervaloFim: string | null;
  fgtsDataOpcao: Date | null;
};

// Campos que já existiam no cadastro e a ficha também traz.
type CamposExistentes = {
  rg: string | null; pis: string | null; birthDate: Date | null; gender: string;
  zipCode: string | null; address: string | null; addressNumber: string | null; addressComplement: string | null;
  neighborhood: string | null; city: string | null; state: string | null;
};

export type CadastroAtual = CamposFicha & CamposExistentes & {
  id: string; firstName: string; lastName: string;
  position: string | null; baseSalary: unknown; admissaoCarteira: Date | null;
  company: { cnpj: string | null } | null;
};

export type Anotacao = {
  tipo: "ADMISSAO" | "SALARIO" | "CARGO"; data: Date;
  salario: number | null; retroativoCompetencia: string | null;
  cargoAnterior: string | null; cboAnterior: string | null; cargo: string | null; cbo: string | null;
};
export type FeriasRow = {
  aquisitivoInicio: Date; aquisitivoFim: Date;
  gozoInicio: Date | null; gozoFim: Date | null; abonoInicio: Date | null; abonoFim: Date | null;
};

export type PlanoFicha = {
  dados: Partial<CamposFicha & CamposExistentes>;
  avisos: string[];
  dependentes: string[];
  ferias: FeriasRow[];
  anotacoes: Anotacao[];
};

const dia = (iso: string | null): Date | null => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const soDigitos = (s: string | null | undefined) => (s ?? "").replace(/[^\dXx]/g, "").toUpperCase();
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const SEXO: Record<string, string> = { Masculino: "MASCULINO", Feminino: "FEMININO" };

export type EnderecoQuebrado = {
  address: string; addressNumber: string | null; addressComplement: string | null;
  neighborhood: string | null; city: string | null; state: string | null;
};

// Endereço no padrão do cadastro: nome próprio, cidade da lista com acento, UF em maiúsculas.
const padraoEndereco = (e: EnderecoQuebrado): EnderecoQuebrado => ({
  address: nomeProprio(e.address)!, addressNumber: e.addressNumber, addressComplement: nomeProprio(e.addressComplement),
  neighborhood: nomeProprio(e.neighborhood), city: cidadeProprio(e.city), state: e.state?.toUpperCase() ?? null,
});

// "Rua DAS FLORES, 10, AP 5, JARDIM TESTE, SAO PAULO, SP" → logradouro, número, complemento, bairro,
// cidade, UF. Sem complemento são 5 partes. Formato inesperado fica inteiro no logradouro.
export function quebrarEndereco(endereco: string): EnderecoQuebrado {
  const p = endereco.split(",").map((s) => s.trim()).filter(Boolean);
  if (p.length === 5) return padraoEndereco({ address: p[0], addressNumber: p[1], addressComplement: null, neighborhood: p[2], city: p[3], state: p[4] });
  if (p.length === 6) return padraoEndereco({ address: p[0], addressNumber: p[1], addressComplement: p[2], neighborhood: p[3], city: p[4], state: p[5] });
  return { address: nomeProprio(endereco)!, addressNumber: null, addressComplement: null, neighborhood: null, city: null, state: null };
}

function cargoAtual(f: FichaRegistro): { cargo: string; cbo: string } {
  const ultimo = f.cargos.at(-1);
  return ultimo?.paraCargo && ultimo.paraCbo ? { cargo: ultimo.paraCargo, cbo: ultimo.paraCbo } : { cargo: f.cargoAdmissao, cbo: f.cboAdmissao };
}

function camposDaFicha(f: FichaRegistro): CamposFicha {
  return {
    nomeCompleto: nomeProprio(f.nome), registroNumero: f.registro, matriculaEsocial: f.matriculaEsocial,
    nomeMae: nomeProprio(f.mae), nomePai: nomeProprio(f.pai),
    estadoCivil: f.estadoCivil, nacionalidade: nomeProprio(f.nacionalidade), naturalidade: cidadeProprio(f.naturalidade),
    racaCor: f.racaCor, escolaridade: f.escolaridade, possuiDeficiencia: f.possuiDeficiencia,
    rgDataEmissao: dia(f.rgEmissao), rgOrgaoEmissor: f.rgOrgao,
    tituloEleitor: f.tituloEleitor, tituloZona: f.tituloZona, tituloSecao: f.tituloSecao,
    ctpsNumero: f.ctpsNumero, ctpsSerie: f.ctpsSerie, ctpsUf: f.ctpsUf, ctpsDataEmissao: dia(f.ctpsEmissao),
    cbo: cargoAtual(f).cbo,
    jornadaInicio: f.jornada?.inicio ?? null, jornadaFim: f.jornada?.fim ?? null,
    intervaloInicio: f.jornada?.intervaloInicio || null, intervaloFim: f.jornada?.intervaloFim || null,
    fgtsDataOpcao: dia(f.fgtsOpcao),
  };
}

const mostrar = (v: unknown) => (v instanceof Date ? iso(v) : String(v));
const igual = (a: unknown, b: unknown) =>
  a instanceof Date || b instanceof Date ? iso(a as Date) === iso(b as Date) : String(a ?? "") === String(b ?? "");

// Erros conhecidos de digitação da contabilidade: a ficha não é corrigida, o campo só não entra.
function errosDaFicha(f: FichaRegistro): { campos: Set<keyof CamposFicha>; avisos: string[] } {
  const campos = new Set<keyof CamposFicha>();
  const avisos: string[] = [];
  const filhos = new Set(f.beneficiarios.map(semAcento));
  for (const [campo, valor, rotulo] of [["nomePai", f.pai, "pai"], ["nomeMae", f.mae, "mãe"]] as const) {
    if (valor && filhos.has(semAcento(valor))) {
      campos.add(campo);
      avisos.push(`a ficha traz o dependente "${valor}" como ${rotulo}: filiação não importada (corrigir com a contabilidade)`);
    }
  }
  if (f.rgEmissao && f.dataNascimento && f.rgEmissao < f.dataNascimento) {
    campos.add("rgDataEmissao");
    avisos.push(`RG emitido em ${f.rgEmissao}, antes do nascimento (${f.dataNascimento}): data de emissão não importada`);
  }
  if (f.matriculaEsocial && f.matriculaEsocial.replace(/^0+/, "") !== f.registro.replace(/^0+/, "")) {
    avisos.push(`matrícula eSocial "${f.matriculaEsocial}" diferente do nº da ficha (${f.registro}): conferir com a contabilidade`);
  }
  return { campos, avisos };
}

function linhasDeCarteira(f: FichaRegistro): Anotacao[] {
  const vazio = { salario: null, retroativoCompetencia: null, cargoAnterior: null, cboAnterior: null, cargo: null, cbo: null };
  return [
    { ...vazio, tipo: "ADMISSAO" as const, data: dia(f.dataAdmissao)!, salario: f.salarioAdmissao, cargo: nomeProprio(f.cargoAdmissao), cbo: f.cboAdmissao },
    ...f.salarios.map((s) => ({ ...vazio, tipo: "SALARIO" as const, data: dia(s.vigencia)!, salario: s.valor, retroativoCompetencia: s.retroativoCompetencia })),
    ...f.cargos.map((c) => ({ ...vazio, tipo: "CARGO" as const, data: dia(c.data)!, cargoAnterior: nomeProprio(c.deCargo), cboAnterior: c.deCbo, cargo: nomeProprio(c.paraCargo), cbo: c.paraCbo })),
  ].sort((a, b) => a.data.getTime() - b.data.getTime());
}

const linhaDeFerias = (x: FichaFerias): FeriasRow => ({
  aquisitivoInicio: dia(x.aquisitivoInicio)!, aquisitivoFim: dia(x.aquisitivoFim)!,
  gozoInicio: dia(x.gozoInicio), gozoFim: dia(x.gozoFim), abonoInicio: dia(x.abonoInicio), abonoFim: dia(x.abonoFim),
});

// O que gravar no cadastro a partir de uma ficha: só o que está vazio; o resto vira aviso.
export function planoDaFicha(atual: CadastroAtual, f: FichaRegistro): PlanoFicha {
  const dados: PlanoFicha["dados"] = {};
  const { campos: comErro, avisos } = errosDaFicha(f);

  const novos = camposDaFicha(f);
  for (const campo of Object.keys(novos) as (keyof CamposFicha)[]) {
    const valor = novos[campo];
    if (valor == null || comErro.has(campo)) continue;
    if (atual[campo] == null) Object.assign(dados, { [campo]: valor });
    else if (!igual(atual[campo], valor)) avisos.push(`${campo}: cadastro "${mostrar(atual[campo])}" × ficha "${mostrar(valor)}" (mantido o do cadastro)`);
  }

  if (f.rg) {
    if (!atual.rg) dados.rg = f.rg.replace(/;/g, "");
    else if (soDigitos(atual.rg) !== soDigitos(f.rg)) avisos.push(`RG: cadastro "${atual.rg}" × ficha "${f.rg}" (mantido o do cadastro)`);
  }
  const pis = f.pis?.replace(/\D/g, "") ?? null;
  if (pis) {
    if (!atual.pis) dados.pis = pis;
    else if (atual.pis !== pis) avisos.push(`PIS: cadastro "${atual.pis}" × ficha "${pis}" (mantido o do cadastro)`);
  }
  const nascimento = dia(f.dataNascimento);
  if (nascimento) {
    if (!atual.birthDate) dados.birthDate = nascimento;
    else if (!igual(atual.birthDate, nascimento)) avisos.push(`nascimento: cadastro ${iso(atual.birthDate)} × ficha ${f.dataNascimento} (mantido o do cadastro)`);
  }
  const sexo = f.sexo ? SEXO[f.sexo] : undefined;
  if (sexo) {
    if (atual.gender === "NAO_INFORMADO") dados.gender = sexo;
    else if (atual.gender !== sexo) avisos.push(`sexo: cadastro ${atual.gender} × ficha ${sexo} (mantido o do cadastro)`);
  }
  // Endereço só entra inteiro, e só se o cadastro não tiver nenhuma parte dele.
  const temEndereco = [atual.zipCode, atual.address, atual.addressNumber, atual.neighborhood, atual.city, atual.state].some(Boolean);
  const daFicha = f.endereco ? { ...quebrarEndereco(f.endereco), zipCode: f.cep } : null;
  if (daFicha && !temEndereco) Object.assign(dados, daFicha);
  else if (daFicha && (Object.keys(daFicha) as (keyof typeof daFicha)[]).some((c) => !igual(atual[c], daFicha[c]))) {
    avisos.push("endereço do cadastro diferente do da ficha: mantido o do cadastro");
  }

  // Conferências do que NÃO é tocado.
  const atualCargo = cargoAtual(f);
  if (atual.position && semAcento(atual.position) !== semAcento(atualCargo.cargo)) avisos.push(`cargo: cadastro "${atual.position}" × ficha "${atualCargo.cargo}" (não alterado)`);
  const ultimoSalario = f.salarios.at(-1)?.valor ?? f.salarioAdmissao;
  if (atual.baseSalary != null && Number(atual.baseSalary) !== ultimoSalario) avisos.push(`salário: cadastro ${Number(atual.baseSalary).toFixed(2)} × ficha ${ultimoSalario.toFixed(2)} (não alterado)`);
  if (!igual(atual.admissaoCarteira, dia(f.dataAdmissao))) avisos.push(`admissão em carteira: cadastro ${iso(atual.admissaoCarteira) ?? "vazio"} × ficha ${f.dataAdmissao} (não alterado)`);
  if (f.empregador.cnpj && atual.company?.cnpj !== f.empregador.cnpj) avisos.push(`empresa: cadastro ${atual.company?.cnpj ?? "sem empresa"} × ficha ${f.empregador.cnpj} (não alterado)`);

  return { dados, avisos, dependentes: f.beneficiarios.map((n) => nomeProprio(n)!), ferias: f.ferias.map(linhaDeFerias), anotacoes: linhasDeCarteira(f) };
}

// ─── Resumo de férias por período aquisitivo ─────────────────────────────────────

// CONTRATO_ENCERRADO: a pessoa saiu sem quitar o período — o acerto é da rescisão.
export type StatusFerias = "EM_AQUISICAO" | "QUITADO" | "A_GOZAR" | "PRAZO_VENCIDO" | "CONTRATO_ENCERRADO";
export type PeriodoFerias = {
  aquisitivoInicio: string; aquisitivoFim: string; concessivoFim: string;
  diasGozados: number; diasAbono: number; status: StatusFerias;
  gozos: { inicio: string; fim: string; abonoInicio: string | null; abonoFim: string | null }[];
};

const DIA_MS = 86_400_000;
const diasEntre = (a: Date | null, b: Date | null) => (a && b && b >= a ? Math.round((b.getTime() - a.getTime()) / DIA_MS) + 1 : 0);
function somarAnos(d: Date, anos: number): Date {
  const r = new Date(d);
  r.setUTCFullYear(r.getUTCFullYear() + anos);
  // 29/02 + 1 ano cai em 01/03: volta para o último dia de fevereiro.
  if (r.getUTCDate() !== d.getUTCDate()) r.setUTCDate(0);
  return r;
}
const vespera = (d: Date) => new Date(d.getTime() - DIA_MS);

// Períodos aquisitivos desde a admissão em carteira até hoje (ou a saída), com o que a ficha
// registra de gozo e abono. 30 dias (gozo + abono) quitam o período. Sem os 30 dias e com o
// período concessivo (12 meses depois do aquisitivo) encerrado: PRAZO_VENCIDO — é o que a
// ficha mostra, não um cálculo de férias em dobro.
export function resumoFerias(admissao: Date, saida: Date | null, linhas: FeriasRow[], hoje: Date): PeriodoFerias[] {
  const limite = saida && saida < hoje ? saida : hoje;
  const porInicio = new Map<string, FeriasRow[]>();
  for (const l of linhas) {
    const k = iso(l.aquisitivoInicio)!;
    porInicio.set(k, [...(porInicio.get(k) ?? []), l]);
  }
  // Períodos que a ficha não lista são gerados a partir da admissão — sempre somando N anos à
  // admissão (encadear desloca 29/02 para 28/02 de vez). Um gerado que cai dentro de um
  // período da ficha não entra: admissão do cadastro um dia diferente da ficha duplicaria
  // cada ano, com o duplicado vazio aparecendo como "Prazo vencido".
  const cobertos = linhas.map((l) => [l.aquisitivoInicio, l.aquisitivoFim] as const);
  const inicios = new Set(porInicio.keys());
  for (let n = 0, ini = admissao; ini <= limite; n++, ini = somarAnos(admissao, n)) {
    const dentro = cobertos.some(([a, b]) => ini >= a && ini <= b);
    const fimGerado = vespera(somarAnos(admissao, n + 1));
    const cobreAlgum = cobertos.some(([a]) => a >= ini && a <= fimGerado);
    if (!dentro && !cobreAlgum) inicios.add(iso(ini)!);
  }

  return [...inicios].sort().map((k) => {
    const ini = dia(k)!;
    const doPeriodo = porInicio.get(k) ?? [];
    const fim = doPeriodo[0]?.aquisitivoFim ?? vespera(somarAnos(ini, 1));
    // Concessivo: os 12 meses seguintes ao aquisitivo (31/10/2017 → 31/10/2018).
    const concessivoFim = somarAnos(fim, 1);
    const diasGozados = doPeriodo.reduce((s, l) => s + diasEntre(l.gozoInicio, l.gozoFim), 0);
    const diasAbono = doPeriodo.reduce((s, l) => s + diasEntre(l.abonoInicio, l.abonoFim), 0);
    let status: StatusFerias;
    if (diasGozados + diasAbono >= 30) status = "QUITADO";
    else if (saida && saida <= hoje) status = "CONTRATO_ENCERRADO";
    else if (fim >= limite) status = "EM_AQUISICAO";
    else status = concessivoFim < hoje ? "PRAZO_VENCIDO" : "A_GOZAR";
    const gozos = doPeriodo
      .filter((l) => l.gozoInicio && l.gozoFim)
      .map((l) => ({ inicio: iso(l.gozoInicio)!, fim: iso(l.gozoFim)!, abonoInicio: iso(l.abonoInicio), abonoFim: iso(l.abonoFim) }));
    return { aquisitivoInicio: k, aquisitivoFim: iso(fim)!, concessivoFim: iso(concessivoFim)!, diasGozados, diasAbono, status, gozos };
  });
}
