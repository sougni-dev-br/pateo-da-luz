// Concluir a ficha: admissão vira funcionário novo; atualização grava no cadastro só os
// dados pessoais que mudaram. Salário, cargo e empresa de quem já trabalha NÃO mudam por
// aqui — esses passam pelo histórico do cadastro (vigência e motivo), no próprio cadastro.
import crypto from "node:crypto";
import { Prisma, type FichaCadastral } from "@prisma/client";
import { prisma } from "../../config/database.js";
import {
  PARA_FUNCIONARIO, cpfValido, diferencas, dividirNome, filhosAlterados, filhosNovos, tipoDaChavePix, valorParaFuncionario,
  type DadosEmpresa, type DadosPessoa, type Filho,
} from "./ficha-cadastral-campos.js";

export class ErroConclusao extends Error {}

const dataUtc = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00.000Z`) : null);

function dependentes(employeeId: string, filhos: Filho[]): Prisma.EmployeeDependenteCreateManyInput[] {
  return filhos.map((f) => ({
    id: crypto.randomUUID(), employeeId, nome: f.nome, parentesco: "Filho(a)",
    dataNascimento: dataUtc(f.dataNascimento), cpf: f.cpf, origem: "FICHA_CADASTRAL",
  }));
}

/** Campos pessoais da ficha no formato do Employee (vazios ficam de fora). */
function camposPessoais(dados: DadosPessoa, so?: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [campo, coluna] of Object.entries(PARA_FUNCIONARIO)) {
    if (so && !so.has(campo)) continue;
    const v = valorParaFuncionario(campo, dados[campo]);
    if (v != null) out[coluna] = v;
  }
  if (out.gender === undefined && so === undefined) out.gender = "NAO_INFORMADO";
  // Chave PIX nova leva o tipo junto: tipo antigo com chave nova manda o pagamento errado.
  if (typeof out.pixKey === "string") out.pixKeyType = tipoDaChavePix(out.pixKey);
  return out;
}

// CPF é único no banco também entre excluídos: a checagem antes cobre os ativos; esta cobre o
// resto (excluído com o mesmo CPF, duas conclusões ao mesmo tempo) com mensagem, não erro 500.
function cpfRepetido(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ErroConclusao("Este CPF já está no cadastro (pode ser de um funcionário excluído — restaure-o em Funcionários).");
  }
  throw error;
}

export async function concluirAdmissao(ficha: FichaCadastral, usuarioId: string) {
  const dados = ficha.dados as DadosPessoa;
  const empresa = ficha.dadosEmpresa as Partial<DadosEmpresa>;
  const cpf = String(dados.cpf ?? "");
  if (!cpfValido(cpf)) throw new ErroConclusao("CPF da ficha inválido.");
  if (!empresa.admissao) throw new ErroConclusao("Preencha a data de admissão antes de concluir.");
  if (!empresa.funcao) throw new ErroConclusao("Preencha a função antes de concluir.");
  if (await prisma.employee.findFirst({ where: { cpf, deletedAt: null }, select: { id: true } })) {
    throw new ErroConclusao("Já existe um funcionário com este CPF. Use \"Pedir atualização de dados\" no cadastro dele.");
  }
  if (empresa.companyId && !(await prisma.company.findUnique({ where: { id: empresa.companyId }, select: { id: true } }))) {
    throw new ErroConclusao("Empresa não encontrada.");
  }
  const { firstName, lastName } = dividirNome(String(dados.nomeCompleto ?? ""));
  if (!firstName || !lastName) throw new ErroConclusao("Nome completo precisa ter nome e sobrenome.");
  // Quem decide o VT é o RH (parte da empresa); sem decisão, vale o que a pessoa respondeu.
  const recebeVt = empresa.valeTransporte ?? dados.usaVt ?? true;
  const trajeto = recebeVt && typeof dados.vtTrajeto === "string" ? `Trajeto do VT informado na ficha: ${dados.vtTrajeto}` : null;
  const id = crypto.randomUUID();
  const data = {
    id, firstName, lastName, ...camposPessoais(dados),
    companyId: empresa.companyId ?? null,
    admissionDate: dataUtc(empresa.admissao),
    position: empresa.funcao,
    baseSalary: empresa.salario ?? null,
    modality: empresa.modalidade ?? "CLT",
    shiftStart: empresa.entrada ?? null, shiftEnd: empresa.saida ?? null,
    jornadaInicio: empresa.entrada ?? null, jornadaFim: empresa.saida ?? null,
    intervaloInicio: empresa.intervaloInicio ?? null, intervaloFim: empresa.intervaloFim ?? null,
    vtType: recebeVt ? "TRANSPORTE_PUBLICO" : "NENHUM",
    notes: trajeto,
    isActive: true,
    createdById: usuarioId,
  } as Prisma.EmployeeUncheckedCreateInput;
  const filhos = Array.isArray(dados.filhos) ? dados.filhos : [];

  return prisma.$transaction(async (tx) => {
    // O funcionário existe antes de a ficha apontar para ele (chave estrangeira). Duas
    // conclusões ao mesmo tempo: a segunda para no CPF único ou na condição do update da ficha,
    // e a transação desfaz o que ela tiver criado.
    const criado = await tx.employee.create({ data }).catch(cpfRepetido);
    if (filhos.length) await tx.employeeDependente.createMany({ data: dependentes(id, filhos) });
    const r = await tx.fichaCadastral.updateMany({
      where: { id: ficha.id, status: "FINALIZADA" },
      data: { status: "CONCLUIDA", concluidaEm: new Date(), concluidaPorId: usuarioId, employeeId: id },
    });
    if (r.count !== 1) throw new ErroConclusao("Esta ficha já foi concluída ou mudou de situação. Recarregue a tela.");
    return { funcionario: criado, campos: Object.keys(data) };
  });
}

export async function concluirAtualizacao(ficha: FichaCadastral, usuarioId: string, camposEscolhidos: string[]) {
  if (!ficha.employeeId) throw new ErroConclusao("Ficha de atualização sem funcionário.");
  const funcionario = await prisma.employee.findFirst({ where: { id: ficha.employeeId, deletedAt: null } });
  if (!funcionario) throw new ErroConclusao("Funcionário não encontrado (foi excluído?).");
  const dados = ficha.dados as DadosPessoa;
  const mudancas = diferencas(dados, funcionario as unknown as Record<string, unknown>);
  const escolhidos = new Set(camposEscolhidos.filter((c) => mudancas.some((m) => m.campo === c)));
  const novos = camposPessoais(dados, escolhidos);
  if (typeof novos.cpf === "string") {
    const conflito = await prisma.employee.findFirst({ where: { cpf: novos.cpf, deletedAt: null, id: { not: funcionario.id } }, select: { id: true } });
    if (conflito) throw new ErroConclusao("O CPF informado já está no cadastro de outro funcionário.");
  }
  const existentes = await prisma.employeeDependente.findMany({
    where: { employeeId: funcionario.id }, select: { id: true, nome: true, dataNascimento: true, cpf: true },
  });
  const listaFilhos = Array.isArray(dados.filhos) ? dados.filhos : [];
  const comFilhos = camposEscolhidos.includes("filhos");
  const filhos = comFilhos ? filhosNovos(listaFilhos, existentes) : [];
  const corrigidos = comFilhos ? filhosAlterados(listaFilhos, existentes) : [];

  return prisma.$transaction(async (tx) => {
    const r = await tx.fichaCadastral.updateMany({
      where: { id: ficha.id, status: "FINALIZADA" },
      data: { status: "CONCLUIDA", concluidaEm: new Date(), concluidaPorId: usuarioId },
    });
    if (r.count !== 1) throw new ErroConclusao("Esta ficha já foi concluída ou mudou de situação. Recarregue a tela.");
    const atualizado = Object.keys(novos).length
      ? await tx.employee.update({ where: { id: funcionario.id }, data: { ...novos, updatedById: usuarioId } }).catch(cpfRepetido)
      : funcionario;
    if (filhos.length) await tx.employeeDependente.createMany({ data: dependentes(funcionario.id, filhos) });
    for (const c of corrigidos) {
      await tx.employeeDependente.update({
        where: { id: c.dependenteId },
        data: {
          ...(c.dataNascimento ? { dataNascimento: dataUtc(c.dataNascimento.novo) } : {}),
          ...(c.cpf ? { cpf: c.cpf.novo } : {}),
        },
      });
    }
    return { antes: funcionario, funcionario: atualizado, filhosIncluidos: filhos.length, filhosCorrigidos: corrigidos.length };
  });
}
