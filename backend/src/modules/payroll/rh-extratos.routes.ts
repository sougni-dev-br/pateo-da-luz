// Consulta dos extratos do RH guardados: lista, holerite por pessoa e o PDF original.
// Salário, rubricas e o PDF são dados pessoais — as três rotas exigem ver Funcionários.
// Nunca devolvem CPF (as tabelas de detalhe nem o guardam).
// Montado dentro de tipCommissionRouter (/payroll/tip).
import { Router, type Request, type Response } from "express";
import { prisma } from "../../config/database.js";
import { getSessionUser } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { nomeCompleto } from "./nomes.js";

export const rhExtratosRouter = Router();

const SEM_PERMISSAO = "Os extratos do RH têm salário e descontos de cada pessoa: só quem pode ver Funcionários tem acesso.";

// 401 sem sessão, 403 sem permissão de dados pessoais; true = pode seguir.
async function autorizado(request: Request, response: Response): Promise<boolean> {
  const user = await getSessionUser(request);
  if (!user) { response.status(401).json({ message: "Sessão obrigatória." }); return false; }
  if (!(await podeVerDadosPessoais(request))) { response.status(403).json({ message: SEM_PERMISSAO }); return false; }
  return true;
}

const n = (v: unknown) => (v == null ? null : Number(v));
const dia = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function inteiroEntre(v: unknown, min: number, max: number): number | null | "invalido" {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isInteger(x) && x >= min && x <= max ? x : "invalido";
}

rhExtratosRouter.get("/extratos", async (request, response) => {
  if (!(await autorizado(request, response))) return;
  const ano = inteiroEntre(request.query.ano, 2000, 2100);
  const mes = inteiroEntre(request.query.mes, 1, 12);
  if (ano === "invalido" || mes === "invalido") return response.status(400).json({ message: "Ano ou mês inválido." });
  const where = { ...(ano ? { competenceYear: ano } : {}), ...(mes ? { competenceMonth: mes } : {}) };

  const extratos = await prisma.rhExtract.findMany({
    where,
    orderBy: [{ competenceYear: "desc" }, { competenceMonth: "desc" }, { calculo: "asc" }, { empresa: "asc" }],
    select: {
      id: true, competenceYear: true, competenceMonth: true, calculo: true, empresa: true, cnpj: true, emissao: true,
      fileName: true, headcount: true, totalLiquido: true, totalProventos: true, totalDescontos: true, createdAt: true, updatedAt: true,
    },
  });
  const ids = extratos.map((e) => e.id);
  // O arquivo não é carregado na lista: só se ele existe.
  const [comArquivo, contagem] = await Promise.all([
    prisma.rhExtract.findMany({ where: { id: { in: ids }, arquivo: { not: null } }, select: { id: true } }),
    prisma.rhExtractPessoa.groupBy({ by: ["rhExtractId", "conferido"], where: { rhExtractId: { in: ids } }, _count: { _all: true } }),
  ]);
  const temArquivo = new Set(comArquivo.map((e) => e.id));
  const conta = (id: string, conferido?: boolean) => contagem
    .filter((c) => c.rhExtractId === id && (conferido === undefined || c.conferido === conferido))
    .reduce((a, c) => a + c._count._all, 0);

  response.json(extratos.map((e) => {
    const pessoas = conta(e.id);
    const naoConferidas = conta(e.id, false);
    return {
      id: e.id, competenceYear: e.competenceYear, competenceMonth: e.competenceMonth, calculo: e.calculo,
      empresa: e.empresa, cnpj: e.cnpj, emissao: dia(e.emissao), fileName: e.fileName, headcount: e.headcount,
      totalLiquido: n(e.totalLiquido), totalProventos: n(e.totalProventos), totalDescontos: n(e.totalDescontos),
      pessoas, naoConferidas,
      // Registro antigo (antes do armazenamento completo): sem pessoas guardadas.
      detalhado: pessoas > 0,
      todasConferidas: pessoas > 0 && naoConferidas === 0,
      temArquivo: temArquivo.has(e.id),
      importadoEm: e.createdAt.toISOString(), atualizadoEm: e.updatedAt ? e.updatedAt.toISOString() : null,
    };
  }));
});

rhExtratosRouter.get("/extratos/:id", async (request, response) => {
  if (!(await autorizado(request, response))) return;
  const e = await prisma.rhExtract.findUnique({
    where: { id: request.params.id },
    select: {
      id: true, competenceYear: true, competenceMonth: true, calculo: true, empresa: true, cnpj: true, emissao: true,
      fileName: true, totalLiquido: true, totalProventos: true, totalDescontos: true,
      pessoas: {
        orderBy: { nome: "asc" },
        select: {
          id: true, employeeId: true, matricula: true, nome: true, situacao: true, vinculo: true, horasMes: true,
          cargoCodigo: true, cargo: true, cbo: true, salarioBase: true, admissao: true, demissao: true, demissaoMotivo: true,
          proventos: true, descontos: true, liquido: true, baseInss: true, baseFgts: true, baseIrrf: true, valorFgts: true,
          liquidoRescisao: true, conferido: true,
          employee: { select: { firstName: true, lastName: true, displayName: true } },
          rubricas: { select: { codigo: true, descricao: true, tipo: true, referencia: true, valor: true } },
        },
      },
    },
  });
  if (!e) return response.status(404).json({ message: "Extrato não encontrado." });

  response.json({
    id: e.id, competenceYear: e.competenceYear, competenceMonth: e.competenceMonth, calculo: e.calculo,
    empresa: e.empresa, cnpj: e.cnpj, emissao: dia(e.emissao), fileName: e.fileName,
    totalLiquido: n(e.totalLiquido), totalProventos: n(e.totalProventos), totalDescontos: n(e.totalDescontos),
    pessoas: e.pessoas.map((p) => ({
      id: p.id, employeeId: p.employeeId, employeeName: p.employee ? nomeCompleto(p.employee) : null,
      matricula: p.matricula, nome: p.nome, situacao: p.situacao, vinculo: p.vinculo, horasMes: n(p.horasMes),
      cargoCodigo: p.cargoCodigo, cargo: p.cargo, cbo: p.cbo, salarioBase: n(p.salarioBase),
      admissao: dia(p.admissao), demissao: dia(p.demissao), demissaoMotivo: p.demissaoMotivo,
      proventos: n(p.proventos), descontos: n(p.descontos), liquido: n(p.liquido),
      baseInss: n(p.baseInss), baseFgts: n(p.baseFgts), baseIrrf: n(p.baseIrrf), valorFgts: n(p.valorFgts),
      liquidoRescisao: n(p.liquidoRescisao), conferido: p.conferido,
      // Proventos primeiro, na ordem de código da contabilidade.
      rubricas: [...p.rubricas]
        .sort((a, b) => (a.tipo === b.tipo ? Number(a.codigo) - Number(b.codigo) : a.tipo === "P" ? -1 : 1))
        .map((r) => ({ codigo: r.codigo, descricao: r.descricao, tipo: r.tipo, referencia: n(r.referencia), valor: n(r.valor) })),
    })),
  });
});

rhExtratosRouter.get("/extratos/:id/arquivo", async (request, response) => {
  if (!(await autorizado(request, response))) return;
  const e = await prisma.rhExtract.findUnique({ where: { id: request.params.id }, select: { arquivo: true, fileName: true } });
  if (!e) return response.status(404).json({ message: "Extrato não encontrado." });
  if (!e.arquivo) {
    return response.status(404).json({ message: "O PDF deste extrato não foi guardado (importado antes do armazenamento no banco). Importe o arquivo de novo para guardá-lo." });
  }
  const nome = (e.fileName || "extrato.pdf").replace(/[^\w.\-() ]/g, "_");
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${nome}"`);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Cache-Control", "private, no-store");
  response.send(Buffer.from(e.arquivo));
});
