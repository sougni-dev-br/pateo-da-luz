/**
 * Captura os relatórios financeiros de todos os meses e compara dois retratos (antes e depois de uma mudança).
 *
 * Uso:
 *   TESTE_EMAIL=... TESTE_SENHA=... npx tsx scripts/comparar-relatorios.ts capturar <urlDoBackend> <saida.json> [anoInicial-mesInicial]
 *   npx tsx scripts/comparar-relatorios.ts comparar <antes.json> <depois.json>
 *
 * O arquivo capturado tem números do restaurante: grave FORA do repositório (público).
 * Conteúdo: DRE do mês (sem comparativos), pendências do DRE, fechamento mensal e CMV real.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Retrato = Record<string, unknown>;

function dentroDeRepositorio(arquivo: string): boolean {
  let atual = dirname(resolve(arquivo));
  for (;;) {
    if (existsSync(join(atual, ".git"))) return true;
    const acima = dirname(atual);
    if (acima === atual) return false;
    atual = acima;
  }
}

async function capturar(base: string, saida: string, inicio: string) {
  if (dentroDeRepositorio(saida)) throw new Error("A saída tem números do restaurante e não pode ficar dentro de um repositório git.");
  const email = process.env.TESTE_EMAIL;
  const senha = process.env.TESTE_SENHA;
  if (!email || !senha) throw new Error("Defina TESTE_EMAIL e TESTE_SENHA (usuário de teste do banco local).");
  const login = (await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: senha, force: true })
  }).then((r) => r.json())) as { token?: string };
  if (!login.token) throw new Error("Login falhou.");
  const cabecalhos = { Authorization: `Bearer ${login.token}` };
  const buscar = async (caminho: string) => {
    const resposta = await fetch(`${base}${caminho}`, { headers: cabecalhos });
    const texto = await resposta.text();
    try { return { status: resposta.status, corpo: JSON.parse(texto) as unknown }; } catch { return { status: resposta.status, corpo: texto.slice(0, 200) }; }
  };

  if (!/^[0-9]{4}-[0-9]{2}$/.test(inicio)) throw new Error(`Mês inicial inválido "${inicio}": use AAAA-MM.`);
  const [anoInicial, mesInicial] = inicio.split("-").map(Number);
  const hoje = new Date();
  const retrato: Retrato = {};
  for (let ano = anoInicial, mes = mesInicial; ano < hoje.getFullYear() || (ano === hoje.getFullYear() && mes <= hoje.getMonth() + 1); mes++) {
    if (mes > 12) { mes = 1; ano++; if (ano > hoje.getFullYear()) break; }
    const chave = `${ano}-${String(mes).padStart(2, "0")}`;
    retrato[`dre ${chave}`] = await buscar(`/dre/summary?year=${ano}&month=${mes}&comparatives=false`);
    retrato[`fechamento ${chave}`] = await buscar(`/monthly-closure/${ano}/${mes}`);
    retrato[`pendencias ${chave}`] = await buscar(`/dre/pending?year=${ano}&month=${mes}&type=all`);
  }
  const periodos = await buscar("/monthly/cmv-real");
  retrato["cmv periodos"] = periodos;
  retrato["cmv bases"] = await buscar("/monthly/cmv-real/bases");
  if (Array.isArray(periodos.corpo)) {
    for (const periodo of periodos.corpo as Array<{ id?: string }>) {
      if (periodo.id) retrato[`cmv ${periodo.id}`] = await buscar(`/monthly/cmv-real/${periodo.id}`);
    }
  }
  writeFileSync(saida, JSON.stringify(retrato));
  // Resposta de erro (permissão, sessão expirada, caminho errado) não é dado: comparar dois erros iguais "passaria".
  const ruins = Object.entries(retrato).filter(([, valor]) => (valor as { status: number }).status < 200 || (valor as { status: number }).status >= 300);
  console.log(`Capturados ${Object.keys(retrato).length} relatórios em ${saida}.`);
  if (ruins.length > 0) {
    console.error(`FALHA: ${ruins.length} relatório(s) sem resposta válida: ${ruins.slice(0, 8).map(([chave, valor]) => `${chave} (${(valor as { status: number }).status})`).join(", ")}`);
    process.exitCode = 1;
  }
}

/** Forma canônica: listas ordenadas pelo conteúdo, porque alguns relatórios devolvem a mesma lista em ordem variável. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (valor && typeof valor === "object") {
    return Object.fromEntries(Object.entries(valor as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, canonico(v)]));
  }
  return valor;
}

function diferencas(a: unknown, b: unknown, caminho: string, achadas: string[]) {
  if (achadas.length >= 25) return;
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const chaves = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const chave of chaves) diferencas((a as Record<string, unknown>)[chave], (b as Record<string, unknown>)[chave], `${caminho}.${chave}`, achadas);
    return;
  }
  achadas.push(`${caminho}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
}

function comparar(antes: string, depois: string) {
  const a = canonico(JSON.parse(readFileSync(antes, "utf-8"))) as Retrato;
  const b = canonico(JSON.parse(readFileSync(depois, "utf-8"))) as Retrato;
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  const semDados = [...chaves].filter((chave) => [a[chave], b[chave]].some((valor) => !valor || (valor as { status?: number }).status === undefined || (valor as { status: number }).status < 200 || (valor as { status: number }).status >= 300));
  if (semDados.length > 0) {
    console.error(`Comparação RECUSADA: ${semDados.length} relatório(s) sem resposta válida em um dos lados (${semDados.slice(0, 6).join(", ")}). Capture de novo.`);
    process.exitCode = 1;
    return;
  }
  let iguais = 0;
  const diferentes: string[] = [];
  for (const chave of chaves) {
    if (JSON.stringify(a[chave]) === JSON.stringify(b[chave])) iguais++;
    else diferentes.push(chave);
  }
  console.log(`Relatórios comparados: ${chaves.size} | idênticos: ${iguais} | diferentes: ${diferentes.length}`);
  for (const chave of diferentes.slice(0, 10)) {
    const achadas: string[] = [];
    diferencas(a[chave], b[chave], chave, achadas);
    console.log(`\n${chave}`);
    for (const linha of achadas.slice(0, 5)) console.log(`  ${linha}`);
  }
  if (diferentes.length > 0) process.exitCode = 1;
}

const [modo, ...args] = process.argv.slice(2);
if (modo === "capturar" && args.length >= 2) {
  capturar(args[0].replace(/\/$/, ""), resolve(args[1]), args[2] ?? "2025-01").catch((erro) => { console.error(erro instanceof Error ? erro.message : erro); process.exitCode = 1; });
} else if (modo === "comparar" && args.length === 2) {
  comparar(resolve(args[0]), resolve(args[1]));
} else {
  console.error("Uso: capturar <url> <saida.json> [AAAA-MM]  |  comparar <antes.json> <depois.json>");
  process.exitCode = 1;
}
