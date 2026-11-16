// Importação da ficha de registro pela tela: prévia (só lê) e aplicação (só o que foi marcado).
// A aplicação refaz a prévia DENTRO da transação, com a pessoa travada, e grava apenas os ids
// marcados que continuam valendo: a tela não envia valores, e cadastro editado entre a prévia
// e a gravação não é sobrescrito às cegas.
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog } from "../security/security-utils.js";
import { registrarAlteracoes } from "./cadastro-historico.service.js";
import { serializar } from "./cadastro-historico.js";
import { ORIGEM_FICHA, type DadosFicha } from "./ficha-registro.js";
import type { FichaRegistro } from "./ficha-registro-parser.js";
import { regravarListasDaFicha } from "./ficha-registro.service.js";
import {
  type Aplicacao, type ContextoFicha, type ItemImportacao, type PrevisaoDaFicha, montarPrevisao,
} from "./ficha-importacao.js";
import { travarFolhaDaPessoa } from "./folha-trava.js";
import { ORIGEM_SALARIO_FICHA } from "./salarios-da-ficha.js";

type Db = Prisma.TransactionClient | typeof prisma;
export type Usuario = { id: string | null; nome: string | null };

export type SituacaoPessoa = "COM_ITENS" | "EM_DIA" | "SEM_CADASTRO" | "CPF_DUPLICADO" | "NOME_DIFERENTE";

export type PessoaPrevista = {
  chave: string;
  employeeId: string | null;
  nome: string;
  registro: string;
  situacao: SituacaoPessoa;
  cadastro: { nome: string; cargo: string | null; empresa: string | null } | null;
  itens: ItemImportacao[];
  suspeitos: string[];
  observacoes: string[];
};

export type ResultadoPessoa = {
  employeeId: string; nome: string; aplicados: string[]; ignorados: { id: string; motivo: string }[];
};

const MOTIVO_PADRAO = "Ficha de registro da contabilidade";
const soDigitos = (s: string) => s.replace(/\D/g, "");
const primeiroNome = (s: string) => s.trim().split(/\s+/)[0]?.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase() ?? "";
const CADASTRO_INCLUDE = { company: { select: { cnpj: true, tradeName: true } } } as const;

async function acharCadastros(db: Db, f: FichaRegistro) {
  // Cadastros antigos guardam o CPF com pontuação: procura as duas formas.
  return db.employee.findMany({ where: { cpf: { in: [soDigitos(f.cpf), f.cpf] }, deletedAt: null }, include: CADASTRO_INCLUDE });
}

async function mapaDeEmpresas(db: Db) {
  const empresas = await db.company.findMany({ select: { id: true, cnpj: true, tradeName: true } });
  return new Map(empresas.map((e) => [e.cnpj, { id: e.id, tradeName: e.tradeName }] as const));
}

async function listasAtuais(db: Db, employeeId: string) {
  const daFicha = { employeeId, origem: ORIGEM_FICHA };
  const [dependentes, ferias, anotacoes] = await Promise.all([
    db.employeeDependente.findMany({ where: daFicha, select: { nome: true } }),
    db.employeeFerias.findMany({ where: daFicha }),
    db.employeeAnotacaoCarteira.findMany({ where: daFicha }),
  ]);
  return {
    dependentes: dependentes.map((d) => d.nome),
    ferias,
    anotacoes: anotacoes.map((a) => ({ tipo: a.tipo, data: a.data, salario: a.salario == null ? null : Number(a.salario), cargo: a.cargo })),
  };
}

async function contextoDe(
  db: Db, cadastro: Awaited<ReturnType<typeof acharCadastros>>[number], empresas: ContextoFicha["empresas"], hoje: string, desde: string | null,
): Promise<ContextoFicha> {
  const [listas, historico] = await Promise.all([
    listasAtuais(db, cadastro.id),
    db.employeeHistorico.findMany({
      where: { employeeId: cadastro.id, campo: { in: ["baseSalary", "position", "companyId"] } },
      select: { campo: true, valorAnterior: true, valorNovo: true, vigenteDesde: true, createdAt: true, origem: true },
    }),
  ]);
  return {
    cadastro, empresas, listas, hoje, desde,
    historicoSalario: historico.filter((l) => l.campo === "baseSalary"),
    historicoCadastro: historico.filter((l) => l.campo !== "baseSalary"),
  };
}

// Pessoa da ficha ainda sem item é "em dia"; o primeiro nome diferente (CPF igual) trava tudo.
function bloquearPorNome(previsao: PrevisaoDaFicha) {
  for (const i of previsao.itens) i.bloqueio = "o primeiro nome da ficha não é o do cadastro (CPF igual): confira antes de gravar.";
}

export async function preverImportacao(fichas: FichaRegistro[], desde: string | null, hoje: string, db: Db = prisma): Promise<PessoaPrevista[]> {
  const empresas = await mapaDeEmpresas(db);
  const pessoas: PessoaPrevista[] = [];
  const vistos = new Set<string>();
  for (const f of fichas) {
    const base = { nome: f.nome, registro: f.registro, cadastro: null, itens: [], suspeitos: [], observacoes: [] };
    const achados = await acharCadastros(db, f);
    // CPF em mais de um cadastro, ou a mesma pessoa em duas fichas do PDF: não há como saber qual vale.
    const repetida = achados.length === 1 && vistos.has(achados[0].id);
    if (achados.length !== 1 || repetida) {
      pessoas.push({ ...base, chave: `sem:${pessoas.length}`, employeeId: null, situacao: achados.length === 0 ? "SEM_CADASTRO" : "CPF_DUPLICADO" });
      continue;
    }
    const [cadastro] = achados;
    vistos.add(cadastro.id);
    const previsao = montarPrevisao(f, await contextoDe(db, cadastro, empresas, hoje, desde));
    const nomeDiferente = primeiroNome(f.nome) !== primeiroNome(cadastro.firstName);
    if (nomeDiferente) bloquearPorNome(previsao);
    pessoas.push({
      ...base, chave: cadastro.id, employeeId: cadastro.id,
      situacao: nomeDiferente ? "NOME_DIFERENTE" : previsao.itens.length === 0 ? "EM_DIA" : "COM_ITENS",
      cadastro: { nome: `${cadastro.firstName} ${cadastro.lastName}`, cargo: cadastro.position, empresa: cadastro.company?.tradeName ?? null },
      itens: previsao.itens, suspeitos: previsao.suspeitos, observacoes: previsao.observacoes,
    });
  }
  return pessoas;
}

// Junta o que vai para o cadastro numa escrita só (campos da ficha + cargo/empresa/salário).
type Gravacao = { dados: DadosFicha; position?: string; companyId?: string; baseSalary?: number };

async function gravarPessoa(
  tx: Prisma.TransactionClient, employeeId: string, escolhidos: string[], previsao: PrevisaoDaFicha,
  cadastro: { position: string | null; companyId: string | null }, motivo: string, usuario: Usuario,
): Promise<ResultadoPessoa["aplicados"]> {
  const g: Gravacao = { dados: {} };
  const aplicados: string[] = [];
  let listas: Extract<Aplicacao, { tipo: "LISTAS" }> | null = null;
  let salario: Extract<Aplicacao, { tipo: "SALARIO" }> | null = null;
  let cargo: Extract<Aplicacao, { tipo: "CARGO" }> | null = null;
  let empresa: Extract<Aplicacao, { tipo: "EMPRESA" }> | null = null;
  for (const id of escolhidos) {
    const a = previsao.aplicacoes.get(id)!;
    aplicados.push(id);
    if (a.tipo === "DADOS") Object.assign(g.dados, a.dados);
    else if (a.tipo === "LISTAS") listas = a;
    else if (a.tipo === "SALARIO") salario = a;
    else if (a.tipo === "CARGO") cargo = a;
    else empresa = a;
  }
  if (cargo) g.position = cargo.cargo;
  if (empresa) g.companyId = empresa.companyId;
  if (salario) g.baseSalary = salario.passos[salario.passos.length - 1].valor;

  if (salario) {
    // createdAt crescente: o histórico reproduz na ordem em que foi REGISTRADO.
    const base = Date.now();
    await tx.employeeHistorico.createMany({
      data: salario.passos.map((p, i) => ({
        id: crypto.randomUUID(), employeeId, campo: "baseSalary",
        valorAnterior: serializar("baseSalary", p.antes), valorNovo: serializar("baseSalary", p.valor),
        vigenteDesde: new Date(`${p.vigencia}T00:00:00.000Z`), motivo, origem: ORIGEM_SALARIO_FICHA,
        criadoPorId: usuario.id, criadoPorNome: usuario.nome, createdAt: new Date(base + i),
      })),
    });
  }
  for (const [campo, aplicacao, antes, depois] of [
    ["position", cargo, cadastro.position, g.position],
    ["companyId", empresa, cadastro.companyId, g.companyId],
  ] as const) {
    if (!aplicacao || depois === undefined) continue;
    await registrarAlteracoes(tx, {
      employeeId, antes: { [campo]: antes }, depois: { [campo]: depois },
      vigenteDesde: new Date(`${aplicacao.vigencia}T00:00:00.000Z`), motivo, origem: "FICHA_REGISTRO", usuario,
    });
  }
  const { dados, ...resto } = g;
  const data = { ...dados, ...resto };
  if (Object.keys(data).length > 0) await tx.employee.update({ where: { id: employeeId }, data });
  if (listas) await regravarListasDaFicha(tx, employeeId, listas.plano);
  return aplicados;
}

export async function aplicarImportacao(
  fichas: FichaRegistro[], selecoes: Record<string, string[]>, desde: string | null, hoje: string,
  motivo: string | null, usuario: Usuario,
): Promise<ResultadoPessoa[]> {
  const empresas = await mapaDeEmpresas(prisma);
  const resultados: ResultadoPessoa[] = [];
  const jaFeitos = new Set<string>();
  for (const f of fichas) {
    const achados = await acharCadastros(prisma, f);
    if (achados.length !== 1) continue;
    const employeeId = achados[0].id;
    // Duas fichas do mesmo CPF no PDF: a segunda não regrava a mesma pessoa.
    if (jaFeitos.has(employeeId)) continue;
    jaFeitos.add(employeeId);
    const pedidos = selecoes[employeeId];
    if (!pedidos || pedidos.length === 0) continue;

    // Erro numa pessoa não derruba as outras: cada uma é uma transação e fica registrado como não gravada.
    let resultado: ResultadoPessoa;
    try {
      resultado = await prisma.$transaction(async (tx) => {
        await travarFolhaDaPessoa(tx, employeeId);
        const atuais = await acharCadastros(tx, f);
        if (atuais.length !== 1 || atuais[0].id !== employeeId) {
          return {
            employeeId, nome: f.nome, aplicados: [],
            ignorados: pedidos.map((id) => ({ id, motivo: "o cadastro mudou depois da prévia (CPF em outro cadastro ou apagado): leia a ficha de novo." })),
          };
        }
        const [cadastro] = atuais;
        const previsao = montarPrevisao(f, await contextoDe(tx, cadastro, empresas, hoje, desde));
        const nomeDiferente = primeiroNome(f.nome) !== primeiroNome(cadastro.firstName);
        if (nomeDiferente) bloquearPorNome(previsao);
        const porId = new Map(previsao.itens.map((i) => [i.id, i]));
        const escolhidos: string[] = [];
        const ignorados: ResultadoPessoa["ignorados"] = [];
        for (const id of [...new Set(pedidos)]) {
          const i = porId.get(id);
          if (!i || !previsao.aplicacoes.has(id)) ignorados.push({ id, motivo: "já não vale: o cadastro mudou ou a ficha não propõe mais isso." });
          else if (i.bloqueio) ignorados.push({ id, motivo: i.bloqueio });
          else escolhidos.push(id);
        }
        const aplicados = escolhidos.length
          ? await gravarPessoa(tx, employeeId, escolhidos, previsao, { position: cadastro.position, companyId: cadastro.companyId }, motivo ?? MOTIVO_PADRAO, usuario)
          : [];
        return { employeeId, nome: `${cadastro.firstName} ${cadastro.lastName}`, aplicados, ignorados };
      }, { timeout: 30_000 });
    } catch (e) {
      // O texto do erro pode trazer CPF e valores do banco: nem ao cliente, nem ao log.
      console.error("[ficha-registro] erro ao gravar:", e instanceof Error ? e.name : "desconhecido");
      const motivoErro = "erro ao gravar esta pessoa: nada foi alterado no cadastro dela.";
      resultado = { employeeId, nome: f.nome, aplicados: [], ignorados: pedidos.map((id) => ({ id, motivo: motivoErro })) };
    }
    resultados.push(resultado);

    if (resultado.aplicados.length > 0) {
      // Só ids e contagens: os valores já estão no cadastro e no histórico dele. O cadastro já foi
      // gravado: falha de auditoria não pode virar erro da pessoa.
      try {
        await auditLog({
          userId: usuario.id, action: "IMPORT_FICHA_REGISTRO_TELA", entity: "Employee", entityId: employeeId,
          newValue: { origem: ORIGEM_FICHA, registro: f.registro, itens: resultado.aplicados },
        });
      } catch (e) {
        console.error("[ficha-registro] auditoria falhou:", e instanceof Error ? e.name : "desconhecido");
      }
    }
  }
  return resultados;
}
