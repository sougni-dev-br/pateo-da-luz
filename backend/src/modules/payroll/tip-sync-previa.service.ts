import { prisma } from "../../config/database.js";
import { carregarParaSync, pontosBaseDoCadastro } from "./tip-commission.service.js";
import { nomeCompleto } from "./nomes.js";
import {
  type DiferencaCadastro, type ForaDoRateio, type PessoaDoCadastro, type PessoaDoPeriodo, diferencasDoSync, foraDoRateio,
} from "./tip-sync-diferencas.js";

export type PreviaSyncCadastro = {
  diferencas: DiferencaCadastro[];
  foraDoRateio: ForaDoRateio[];
  /** Desligados de ciclos anteriores que ainda estão com "Participa" marcado no cadastro. */
  desligadosComParticipaMarcado: number;
};

type ComNome = { id: string; firstName?: string; lastName?: string; displayName?: string | null };
const nomeDe = (e: ComNome) => nomeCompleto({ firstName: e.firstName ?? "", lastName: e.lastName ?? "", displayName: e.displayName });

// Só leitura: o que "Atualizar do cadastro" faria agora no período, quem está fora do rateio e por
// quê. A tela mostra isso antes de alguém precisar descobrir que o cadastro mudou.
export async function previaSyncCadastro(periodId: string): Promise<PreviaSyncCadastro> {
  const { periodo, elegiveis, emTeste, soSalario, existing } = await carregarParaSync(periodId);

  const daPessoa = (e: ComNome & { tipoGorjeta?: "PONTOS" | "FIXO"; tipFunction: { name: string; points?: unknown } | null; pontosExtra?: unknown }): PessoaDoCadastro => ({
    id: e.id,
    nome: nomeDe(e),
    funcao: e.tipFunction?.name ?? null,
    pontos: e.tipFunction ? pontosBaseDoCadastro({ pontosExtra: e.pontosExtra ?? null, tipFunction: { points: e.tipFunction.points ?? 0 } }) : 0,
    tipoGorjeta: e.tipoGorjeta ?? "PONTOS",
  });
  const diferencas = diferencasDoSync({
    elegiveis: elegiveis.map(daPessoa),
    soSalario: soSalario.map((e) => ({ id: e.id, nome: nomeDe(e), funcao: e.tipFunction?.name ?? null, pontos: 0, tipoGorjeta: "PONTOS" as const })),
    emTeste: emTeste.map(daPessoa),
    existentes: existing.map((x) => ({
      employeeId: x.employeeId,
      basePoints: x.basePoints == null ? null : Number(x.basePoints),
      functionName: x.functionName,
      foraDaGorjeta: x.foraDaGorjeta,
      vales: x._count.vales,
    })),
  });

  const comVinculo = await prisma.employee.findMany({
    where: {
      deletedAt: null,
      AND: [
        { OR: [{ admissionDate: null }, { admissionDate: { lte: periodo.periodEnd } }] },
        { OR: [{ isActive: true }, { terminationDate: { gte: periodo.periodStart } }] },
      ],
    },
    select: {
      id: true, firstName: true, lastName: true, displayName: true, modality: true, participaGorjeta: true, inicioGorjeta: true,
      tipoGorjeta: true, pontosExtra: true, tipFunction: { select: { name: true, points: true } },
    },
  });
  const pessoas: PessoaDoPeriodo[] = comVinculo.map((e) => ({
    id: e.id, nome: nomeDe(e), modality: e.modality as "CLT" | "NAO_CLT", participaGorjeta: e.participaGorjeta,
    inicioGorjeta: e.inicioGorjeta ?? null, tipoGorjeta: e.tipoGorjeta as "PONTOS" | "FIXO",
    pontos: e.tipFunction ? pontosBaseDoCadastro({ pontosExtra: e.pontosExtra, tipFunction: e.tipFunction }) : 0,
  }));
  const soSalarioIds = new Set(existing.filter((x) => x.foraDaGorjeta).map((x) => x.employeeId));

  const desligadosComParticipaMarcado = await prisma.employee.count({
    where: { deletedAt: null, isActive: false, participaGorjeta: true, terminationDate: { lt: periodo.periodStart } },
  });

  return { diferencas, foraDoRateio: foraDoRateio(pessoas, periodo.periodEnd, soSalarioIds), desligadosComParticipaMarcado };
}
