// Importação da ficha de registro pela tela: o que cada ficha propõe para o cadastro, em itens
// que a pessoa marca ou desmarca. Regras puras (sem banco). O que muda de fato é recalculado
// no servidor na hora de gravar, só para os ids marcados — a tela não manda valor nenhum.
import type { FichaRegistro } from "./ficha-registro-parser.js";
import {
  type CadastroAtual, type DadosFicha, type FeriasRow, type PlanoFicha, ROTULO_CAMPO_FICHA,
  cargoAtual, errosDaFicha, planoDaFicha, semAcento,
} from "./ficha-registro.js";
import { type PassoPlanejado, passosDaFicha, planejarSalarios, textoDoPasso, type LinhaSalario } from "./salarios-da-ficha.js";
import { nomeProprio } from "../../shared/utils/nome-proprio.js";

export type TipoItem = "PREENCHE" | "DIVERGE" | "SALARIO" | "CARGO" | "EMPRESA" | "LISTAS";

export type ItemImportacao = {
  id: string;
  tipo: TipoItem;
  rotulo: string;
  atual: string | null;
  ficha: string | null;
  detalhes: string[];
  // Já vem marcado: só o que preenche campo vazio (e as listas, na primeira importação).
  padrao: boolean;
  // Por que o item não pode ser gravado (vazio = pode).
  bloqueio: string | null;
};

// O que gravar quando o item é marcado.
export type Aplicacao =
  | { tipo: "DADOS"; dados: DadosFicha }
  | { tipo: "SALARIO"; passos: PassoPlanejado[] }
  | { tipo: "CARGO"; cargo: string; vigencia: string }
  | { tipo: "EMPRESA"; companyId: string; vigencia: string }
  | { tipo: "LISTAS"; plano: Pick<PlanoFicha, "dependentes" | "ferias" | "anotacoes"> };

export type CadastroParaFicha = CadastroAtual & {
  isActive: boolean; admissionDate: Date | null; terminationDate: Date | null;
  company: { cnpj: string | null; tradeName?: string | null } | null;
};

export type ListasAtuais = {
  dependentes: string[];
  ferias: FeriasRow[];
  anotacoes: { tipo: string; data: Date; salario: number | null; cargo: string | null }[];
};

export type ContextoFicha = {
  cadastro: CadastroParaFicha;
  empresas: ReadonlyMap<string, { id: string; tradeName: string }>; // por CNPJ
  historicoSalario: readonly LinhaSalario[];
  // Mudanças de cargo e de empresa já registradas no cadastro (datas de vigência).
  historicoCadastro: readonly { campo: string; vigenteDesde: Date; origem?: string | null }[];
  listas: ListasAtuais;
  hoje: string;   // AAAA-MM-DD
  desde: string | null; // AAAA-MM-DD: degraus de salário da ficha a partir desta data
};

export type PrevisaoDaFicha = {
  itens: ItemImportacao[];
  aplicacoes: Map<string, Aplicacao>;
  // Erros evidentes da ficha (filiação com nome de dependente, RG antes do nascimento...): só avisa.
  suspeitos: string[];
  observacoes: string[];
};

const ENDERECO = ["address", "addressNumber", "addressComplement", "neighborhood", "city", "state", "zipCode"] as const;
const ddmmaaaa = (iso: string) => iso.split("-").reverse().join("/");
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const texto = (v: unknown): string | null => (v == null ? null : v instanceof Date ? iso(v) : String(v));
const reais = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const SEXO_NA_TELA: Record<string, string> = { MASCULINO: "Masculino", FEMININO: "Feminino", NAO_INFORMADO: "Não informado" };

// O que o usuário lê: data em dia/mês/ano, sim/não e o sexo por extenso (o banco guarda ISO, boolean e enum).
function paraTela(v: string | null): string | null {
  if (v === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return ddmmaaaa(v);
  if (v === "true") return "Sim";
  if (v === "false") return "Não";
  return SEXO_NA_TELA[v] ?? v;
}

function item(parcial: Pick<ItemImportacao, "id" | "tipo" | "rotulo"> & Partial<ItemImportacao>): ItemImportacao {
  const completo = { atual: null, ficha: null, detalhes: [], padrao: false, bloqueio: null, ...parcial };
  return { ...completo, atual: paraTela(completo.atual), ficha: paraTela(completo.ficha) };
}

// Preenche campo vazio (um item por campo; o endereço entra inteiro, num item só).
function itensDePreenchimento(dados: DadosFicha, atual: CadastroAtual, out: PrevisaoDaFicha) {
  const campos = Object.keys(dados) as (keyof DadosFicha)[];
  const temEndereco = campos.some((c) => (ENDERECO as readonly string[]).includes(c));
  if (temEndereco) {
    const parte = Object.fromEntries(campos.filter((c) => (ENDERECO as readonly string[]).includes(c)).map((c) => [c, dados[c]]));
    const resumo = [parte.address, parte.addressNumber, parte.neighborhood, parte.city].filter(Boolean).join(", ");
    out.itens.push(item({ id: "preenche:endereco", tipo: "PREENCHE", rotulo: ROTULO_CAMPO_FICHA.endereco, ficha: resumo, padrao: true }));
    out.aplicacoes.set("preenche:endereco", { tipo: "DADOS", dados: parte as DadosFicha });
  }
  for (const c of campos) {
    if ((ENDERECO as readonly string[]).includes(c)) continue;
    const id = `preenche:${c}`;
    out.itens.push(item({ id, tipo: "PREENCHE", rotulo: ROTULO_CAMPO_FICHA[c] ?? c, atual: texto((atual as Record<string, unknown>)[c]), ficha: texto(dados[c]), padrao: true }));
    out.aplicacoes.set(id, { tipo: "DADOS", dados: { [c]: dados[c] } });
  }
}

function itemDeSalario(f: FichaRegistro, ctx: ContextoFicha, out: PrevisaoDaFicha) {
  if (!ctx.desde) return;
  const { cadastro: emp } = ctx;
  const atualSalario = emp.baseSalary == null ? null : Number(emp.baseSalary);
  const plano = planejarSalarios(passosDaFicha(f, ctx.desde), ctx.historicoSalario, atualSalario, ctx.desde);
  if (plano.avisos.length > 0) {
    out.itens.push(item({ id: "salario", tipo: "SALARIO", rotulo: "Salário", atual: atualSalario == null ? null : reais(atualSalario), detalhes: plano.avisos, bloqueio: plano.avisos[0] }));
    return;
  }
  if (plano.passos.length === 0) return;
  const motivos: string[] = [];
  if (emp.terminationDate) motivos.push("desligado: mexer no salário retroativo muda a rescisão; confira à mão.");
  if (plano.passos.some((p) => p.vigencia > ctx.hoje)) motivos.push("há degrau com vigência futura: ainda não pode ser gravado.");
  const admissao = iso(emp.admissionDate);
  if (admissao && plano.passos.some((p) => p.vigencia < admissao)) motivos.push(`há degrau anterior à admissão do cadastro (${ddmmaaaa(admissao)}): corrija a admissão antes.`);
  const ultimo = plano.passos[plano.passos.length - 1];
  out.itens.push(item({
    id: "salario", tipo: "SALARIO", rotulo: "Salário", atual: atualSalario == null ? null : reais(atualSalario), ficha: reais(ultimo.valor),
    detalhes: plano.passos.map(textoDoPasso), bloqueio: motivos[0] ?? null,
  }));
  out.aplicacoes.set("salario", { tipo: "SALARIO", passos: plano.passos });
}

// Mudança de cargo ou de empresa feita à mão com vigência igual ou posterior à da ficha: gravar
// a da ficha por cima reescreveria o passado sem ninguém conferir (mesma regra do salário).
function mudancaAMao(ctx: ContextoFicha, campo: "position" | "companyId", vigencia: string): string | null {
  const achada = ctx.historicoCadastro.filter((l) => l.campo === campo && iso(l.vigenteDesde)! >= vigencia && l.origem !== "FICHA_REGISTRO");
  if (achada.length === 0) return null;
  const quando = achada.map((l) => ddmmaaaa(iso(l.vigenteDesde)!)).join(", ");
  return `o cadastro já tem mudança de ${campo === "position" ? "cargo" : "empresa"} valendo desde ${quando}: confira à mão.`;
}

function itemDeCargo(f: FichaRegistro, ctx: ContextoFicha, out: PrevisaoDaFicha) {
  const { cadastro: emp } = ctx;
  const daFicha = nomeProprio(cargoAtual(f).cargo);
  if (!daFicha || (emp.position && semAcento(emp.position) === semAcento(daFicha))) return;
  const ultima = f.cargos.at(-1)?.data;
  const vigencia = ultima && ultima <= ctx.hoje ? ultima : ctx.hoje;
  const bloqueio = mudancaAMao(ctx, "position", vigencia);
  out.itens.push(item({ id: "cargo", tipo: "CARGO", rotulo: "Cargo", atual: emp.position, ficha: daFicha, detalhes: [`vale desde ${ddmmaaaa(vigencia)}`], bloqueio }));
  out.aplicacoes.set("cargo", { tipo: "CARGO", cargo: daFicha, vigencia });
}

function itemDeEmpresa(f: FichaRegistro, ctx: ContextoFicha, out: PrevisaoDaFicha) {
  const cnpj = f.empregador.cnpj;
  if (!cnpj || ctx.cadastro.company?.cnpj === cnpj) return;
  const empresa = ctx.empresas.get(cnpj);
  const atual = ctx.cadastro.company?.tradeName ?? ctx.cadastro.company?.cnpj ?? null;
  if (!empresa) {
    out.itens.push(item({ id: "empresa", tipo: "EMPRESA", rotulo: "Empresa", atual, ficha: f.empregador.nome ?? cnpj, bloqueio: `o CNPJ ${cnpj} não está cadastrado em Empresas.` }));
    return;
  }
  out.itens.push(item({ id: "empresa", tipo: "EMPRESA", rotulo: "Empresa", atual, ficha: empresa.tradeName, detalhes: [`vale desde ${ddmmaaaa(ctx.hoje)}`], bloqueio: mudancaAMao(ctx, "companyId", ctx.hoje) }));
  out.aplicacoes.set("empresa", { tipo: "EMPRESA", companyId: empresa.id, vigencia: ctx.hoje });
}

const chaveFerias = (r: FeriasRow) => [r.aquisitivoInicio, r.aquisitivoFim, r.gozoInicio, r.gozoFim, r.abonoInicio, r.abonoFim].map((d) => iso(d) ?? "-").join("|");
const chaveCarteira = (a: { tipo: string; data: Date; salario: number | null; cargo: string | null }) => `${a.tipo}|${iso(a.data)}|${a.salario ?? "-"}|${a.cargo ?? "-"}`;
const mesmoConjunto = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function itemDeListas(plano: PlanoFicha, ctx: ContextoFicha, out: PrevisaoDaFicha) {
  const { listas } = ctx;
  const linhas: { nome: string; atual: number; ficha: number; mudou: boolean }[] = [
    { nome: "Dependentes", atual: listas.dependentes.length, ficha: plano.dependentes.length, mudou: !mesmoConjunto(listas.dependentes, plano.dependentes) },
    { nome: "Períodos de férias", atual: listas.ferias.length, ficha: plano.ferias.length, mudou: !mesmoConjunto(listas.ferias.map(chaveFerias), plano.ferias.map(chaveFerias)) },
    { nome: "Histórico da carteira", atual: listas.anotacoes.length, ficha: plano.anotacoes.length, mudou: !mesmoConjunto(listas.anotacoes.map(chaveCarteira), plano.anotacoes.map((a) => chaveCarteira({ tipo: a.tipo, data: a.data, salario: a.salario, cargo: a.cargo }))) },
  ];
  const mudam = linhas.filter((l) => l.mudou);
  if (mudam.length === 0) return;
  const jaTinha = linhas.some((l) => l.atual > 0);
  out.itens.push(item({
    id: "listas", tipo: "LISTAS", rotulo: "Férias, carteira e dependentes",
    detalhes: mudam.map((l) => `${l.nome}: ${l.atual} no cadastro → ${l.ficha} na ficha`),
    // Primeira importação entra marcada; trocar o que já está gravado exige marcar.
    padrao: !jaTinha,
  }));
  out.aplicacoes.set("listas", { tipo: "LISTAS", plano: { dependentes: plano.dependentes, ferias: plano.ferias, anotacoes: plano.anotacoes } });
}

function observacoesDaAdmissao(f: FichaRegistro, emp: CadastroParaFicha): string[] {
  const daFicha = f.dataAdmissao;
  if (iso(emp.admissionDate) === daFicha || iso(emp.admissaoCarteira) === daFicha) return [];
  return [`admissão: cadastro ${emp.admissionDate ? ddmmaaaa(iso(emp.admissionDate)!) : "vazia"} (carteira ${emp.admissaoCarteira ? ddmmaaaa(iso(emp.admissaoCarteira)!) : "vazia"}) × ficha ${ddmmaaaa(daFicha)}: confira, a importação não mexe na admissão.`];
}

export function montarPrevisao(f: FichaRegistro, ctx: ContextoFicha): PrevisaoDaFicha {
  const plano = planoDaFicha(ctx.cadastro, f);
  const out: PrevisaoDaFicha = { itens: [], aplicacoes: new Map(), suspeitos: errosDaFicha(f).avisos, observacoes: observacoesDaAdmissao(f, ctx.cadastro) };

  itensDePreenchimento(plano.dados, ctx.cadastro, out);
  for (const d of plano.divergencias) {
    const id = `diverge:${d.campo}`;
    out.itens.push(item({ id, tipo: "DIVERGE", rotulo: d.rotulo, atual: d.atual, ficha: d.ficha }));
    out.aplicacoes.set(id, { tipo: "DADOS", dados: d.valor });
  }
  itemDeSalario(f, ctx, out);
  itemDeCargo(f, ctx, out);
  itemDeEmpresa(f, ctx, out);
  itemDeListas(plano, ctx, out);
  return out;
}
