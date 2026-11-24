// RH → Brindes para o modo ?mock-user=1 (só em dev, sem backend). Nomes fictícios; guarda estado
// para dar para marcar, corrigir e desfazer pela tela.
import type { DetalheBrinde, EntregaBrinde, PessoaBrinde } from "../api/client";

type Base = Pick<PessoaBrinde, "employeeId" | "nome" | "empresa" | "setor" | "cargo"> & { ativo?: boolean; saidaEm?: string | null };
const BASE: Base[] = [
  { employeeId: "b1", nome: "Ana Exemplo", empresa: "ALFA EXEMPLO", setor: "Salão", cargo: "Garçonete" },
  { employeeId: "b2", nome: "Bruno Exemplo", empresa: "ALFA EXEMPLO", setor: "Cozinha", cargo: "Cozinheiro" },
  { employeeId: "b3", nome: "Carla Exemplo", empresa: "ALFA EXEMPLO", setor: "Salão", cargo: "Caixa", saidaEm: "2026-12-31" },
  { employeeId: "b4", nome: "Diego Exemplo", empresa: "BETA EXEMPLO", setor: "Bar", cargo: "Barman" },
  { employeeId: "b5", nome: "Elisa Exemplo", empresa: "BETA EXEMPLO", setor: "Cozinha", cargo: "Auxiliar" },
  { employeeId: "b6", nome: "Fábio Exemplo", empresa: "BETA EXEMPLO", setor: "Salão", cargo: "Garçom", ativo: false },
];
const hoje = () => new Date().toISOString().slice(0, 10);
const entregas = new Map<string, EntregaBrinde>([
  ["b1", { id: "e-b1", entregueEm: "2026-12-18", observacao: null, registradoPor: "Mock Admin" }],
  ["b6", { id: "e-b6", entregueEm: "2026-12-18", observacao: "Recebeu antes de sair", registradoPor: "Mock Admin" }],
]);

function detalhe(): DetalheBrinde {
  const pessoas: PessoaBrinde[] = BASE.map((b) => ({
    employeeId: b.employeeId, nome: b.nome, nomeCompleto: `${b.nome} da Silva`, empresa: b.empresa, setor: b.setor, cargo: b.cargo,
    ativo: b.ativo ?? true, saidaEm: b.saidaEm ?? null, entrega: entregas.get(b.employeeId) ?? null,
  }));
  const ativos = pessoas.filter((p) => p.ativo);
  const entregues = ativos.filter((p) => p.entrega).length;
  return {
    hoje: hoje(),
    campanha: { id: "mock-brinde", nome: "Brinde de Natal", ano: 2026, observacao: null },
    resumo: { ativos: ativos.length, entregues, faltam: ativos.length - entregues, entreguesDeInativos: pessoas.filter((p) => !p.ativo && p.entrega).length },
    pessoas,
  };
}

export function mockBrindes(url: string, method = "GET", corpo?: unknown): unknown | undefined {
  const path = url.split("?")[0];
  const i = path.indexOf("/payroll/brindes");
  if (i < 0) return undefined;
  const resto = path.slice(i + "/payroll/brindes".length).split("/").filter(Boolean);
  const dados = (typeof corpo === "string" ? JSON.parse(corpo || "{}") : corpo ?? {}) as { entregueEm?: string; observacao?: string | null; employeeIds?: string[] };
  if (resto.length === 0) {
    const d = detalhe();
    return { hoje: d.hoje, ativos: d.resumo.ativos, campanhas: [{ ...d.campanha, entregues: d.pessoas.filter((p) => p.entrega).length }] };
  }
  if (resto.length === 1) return detalhe();
  if (resto[1] === "entregas" && resto[2] === "lote") {
    let marcados = 0;
    for (const id of dados.employeeIds ?? []) {
      const b = BASE.find((x) => x.employeeId === id);
      if (b && (b.ativo ?? true) && !entregas.has(id)) { entregas.set(id, { id: `e-${id}`, entregueEm: dados.entregueEm ?? hoje(), observacao: null, registradoPor: "Mock Admin" }); marcados += 1; }
    }
    return { marcados, jaMarcadosOuInativos: (dados.employeeIds ?? []).length - marcados };
  }
  const employeeId = resto[2];
  if (method === "DELETE") { entregas.delete(employeeId); return { ok: true }; }
  const anterior = entregas.get(employeeId);
  entregas.set(employeeId, {
    id: `e-${employeeId}`, entregueEm: dados.entregueEm ?? anterior?.entregueEm ?? hoje(),
    observacao: "observacao" in dados ? dados.observacao ?? null : anterior?.observacao ?? null, registradoPor: anterior?.registradoPor ?? "Mock Admin",
  });
  return { id: `e-${employeeId}` };
}
