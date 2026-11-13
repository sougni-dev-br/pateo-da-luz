// Salário do cadastro × salário da ficha de registro da contabilidade — regras puras (sem banco).
//
// A ficha traz a linha do tempo do salário (admissão + cada alteração, com a vigência). O
// cadastro guarda o histórico com "vale a partir de". Aqui sai a lista do que falta no
// cadastro para igualar à ficha, a partir de uma data (ex.: o dissídio de 01/11/2026), sem
// reescrever o passado anterior a ela. Rodar de novo, depois de aplicado, não acha mais nada.
import type { FichaRegistro } from "./ficha-registro-parser.js";
import { type LinhaHistorico, serializar, valorVigenteEm } from "./cadastro-historico.js";

export const ORIGEM_SALARIO_FICHA = "FICHA_REGISTRO";
// Linha do histórico como vem do banco; `origem` é opcional nos testes.
export type LinhaSalario = LinhaHistorico & { origem?: string | null };

export type PassoDaFicha = { vigencia: string; valor: number; origem: "ADMISSAO" | "ALTERACAO" };

export type PassoPlanejado = PassoDaFicha & { antes: number | null };

export type PlanoSalarial = {
  passos: PassoPlanejado[];
  // Vazio = nada a fazer (já igual) ou não dá para fazer sozinho (ver `avisos`).
  avisos: string[];
};

const dia = (d: Date) => d.toISOString().slice(0, 10);
const dinheiro = (n: number | null) => (n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));
const ddmmaaaa = (iso: string) => iso.split("-").reverse().join("/");

// Os degraus da ficha com vigência a partir de `desde` (AAAA-MM-DD), em ordem de data. A
// admissão conta como degrau: ela pega o salário de entrada gravado errado no cadastro.
export function passosDaFicha(
  f: Pick<FichaRegistro, "dataAdmissao" | "salarioAdmissao" | "salarios">, desde: string,
): PassoDaFicha[] {
  const todos: PassoDaFicha[] = [
    { vigencia: f.dataAdmissao, valor: f.salarioAdmissao, origem: "ADMISSAO" },
    ...f.salarios.map((s) => ({ vigencia: s.vigencia, valor: s.valor, origem: "ALTERACAO" as const })),
  ];
  return todos
    .filter((p) => p.vigencia >= desde && Number.isFinite(p.valor) && p.valor > 0)
    .sort((a, b) => a.vigencia.localeCompare(b.vigencia));
}

// `linhas`: o histórico do cadastro (só o campo baseSalary basta). `atual`: o salário de hoje.
export function planejarSalarios(
  passos: readonly PassoDaFicha[], linhas: readonly LinhaSalario[], atual: number | null, desde: string,
): PlanoSalarial {
  const doSalario = linhas.filter((l) => l.campo === "baseSalary");
  const simuladas: LinhaSalario[] = [...doSalario];
  const planejados: PassoPlanejado[] = [];
  let momento = Date.now();
  for (const p of passos) {
    const vigente = valorVigenteEm(simuladas, serializar("baseSalary", atual), new Date(`${p.vigencia}T00:00:00.000Z`));
    if (vigente === serializar("baseSalary", p.valor)) continue;
    const antes = vigente == null ? null : Number(vigente);
    planejados.push({ ...p, antes });
    // Registrada depois das outras: é a ordem em que o histórico a reproduz.
    momento += 1;
    simuladas.push({
      campo: "baseSalary", valorAnterior: vigente, valorNovo: serializar("baseSalary", p.valor),
      vigenteDesde: new Date(`${p.vigencia}T00:00:00.000Z`), createdAt: new Date(momento),
    });
  }
  if (planejados.length === 0) return { passos: [], avisos: [] };
  // Já há mudança de salário no cadastro a partir da data: alguém mexeu à mão. Misturar a
  // ficha por cima mudaria cálculo de mês passado sem ninguém conferir: fica para a mão.
  // As linhas que este mesmo processo gravou antes não contam: uma aplicação que parou no meio
  // (degrau 1 gravado, degrau 2 não) tem de poder ser completada.
  const jaMexido = doSalario.filter((l) => dia(l.vigenteDesde) >= desde && l.origem !== ORIGEM_SALARIO_FICHA);
  if (jaMexido.length > 0) {
    const quando = jaMexido.map((l) => ddmmaaaa(dia(l.vigenteDesde))).join(", ");
    return {
      passos: [],
      avisos: [`o cadastro já tem mudança de salário valendo desde ${quando} e ela difere da ficha: confira à mão (nada foi proposto).`],
    };
  }
  return { passos: planejados, avisos: [] };
}

export const textoDoPasso = (p: PassoPlanejado) => {
  const variacao = p.antes != null && p.antes > 0 ? ` (${(((p.valor - p.antes) / p.antes) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2, signDisplay: "exceptZero" })}%)` : "";
  const rotulo = p.origem === "ADMISSAO" ? "salário de admissão" : "alteração salarial";
  return `desde ${ddmmaaaa(p.vigencia)}: ${dinheiro(p.antes)} → ${dinheiro(p.valor)}${variacao} [${rotulo}]`;
};
