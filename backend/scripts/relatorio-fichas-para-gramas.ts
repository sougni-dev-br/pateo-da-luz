/**
 * RELATÓRIO (somente leitura) — o que mudaria se as fichas técnicas fossem refeitas em g/ml.
 *
 * Este script NÃO grava nada: só faz `findMany` e imprime. Não tem modo de escrita.
 *
 * Regras da proposta, por ingrediente:
 *   - já em G ou ML ............................ nada a fazer
 *   - KG → G (×1000) · L → ML (×1000) .......... conversão física, custo idêntico
 *   - em UN/PCT/CX e o produto tem conversão
 *     (cadastrada ou lida do nome) para g ...... g = quantidade ÷ fator(G→unidade do estoque)
 *   - idem, só com conversão para ml ........... ml
 *   - sem conversão nenhuma .................... PENDENTE: alguém precisa informar "1 UN = ? g"
 * Depois de propor, o script RECALCULA o custo do ingrediente na nova unidade com o mesmo
 * cálculo da ficha e compara com o de hoje: diferença acima da tolerância vira "CONFERIR".
 *
 * Uso (de dentro de backend/), com a URL do banco na variável de ambiente — nunca em arquivo versionado:
 *   TZ=UTC DATABASE_URL="postgresql://..." npx tsx scripts/relatorio-fichas-para-gramas.ts
 *   ... --desde=2026-10-08        só fichas criadas ou alteradas a partir desta data
 *   ... --csv=relatorio-fichas.csv  grava também um CSV (arquivo local, não toca no banco)
 *   ... --so-mudancas              omite os ingredientes que já estão em g/ml
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import { arredonda as _a, csv, moeda, lerPlano, type Decisao } from "./fichas-gramas-plano.js";
void _a;

const argumentos = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [chave, ...resto] = a.replace(/^--/, "").split("=");
    return [chave, resto.length ? resto.join("=") : "true"];
  })
);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("Defina DATABASE_URL (veja o topo do arquivo). Nada foi lido.");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const desde = argumentos.desde ? new Date(`${argumentos.desde}T00:00:00.000Z`) : null;
  if (desde && Number.isNaN(desde.getTime())) {
    console.error(`--desde inválido: ${argumentos.desde} (use AAAA-MM-DD)`);
    process.exit(1);
  }

  console.log("RELATÓRIO SOMENTE LEITURA — nenhuma linha do banco será alterada.");

  const { pratos, linhas } = await lerPlano(prisma, desde);

  // ─── Relatório ───
  const visiveis = argumentos["so-mudancas"] ? linhas.filter((l) => l.decisao !== "JA-ESTA") : linhas;
  let pratoAtual = "";
  for (const l of visiveis) {
    if (l.prato !== pratoAtual) {
      pratoAtual = l.prato;
      console.log(`\n■ ${l.prato}${l.ativo ? "" : "  (inativo)"}  — alterado em ${l.atualizadoEm}`);
    }
    const de = `${l.quantidadeHoje.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${l.unidadeHoje}`;
    const para = l.unidadeNova ? `${l.quantidadeNova?.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${l.unidadeNova}` : "?";
    console.log(`  [${l.decisao.padEnd(8)}] ${l.produto}: ${de} → ${para}   custo ${moeda(l.custoHoje)} → ${moeda(l.custoNovo)}   ${l.motivo}`);
  }

  const contagem = (d: Decisao) => linhas.filter((l) => l.decisao === d).length;
  const pratosComPendencia = new Set(linhas.filter((l) => l.decisao === "PENDENTE" || l.decisao === "CONFERIR").map((l) => l.prato));
  console.log("\n──────── RESUMO ────────");
  console.log(`Fichas lidas: ${pratos.length}${desde ? ` (criadas/alteradas desde ${argumentos.desde})` : ""} · ingredientes: ${linhas.length}`);
  console.log(`Já em g/ml: ${contagem("JA-ESTA")} · mudariam: ${contagem("MUDA")} · pendentes (sem conversão): ${contagem("PENDENTE")} · conferir (custo diverge): ${contagem("CONFERIR")}`);
  console.log(`Fichas com pelo menos uma pendência ou divergência: ${pratosComPendencia.size}`);

  const pendentes = new Map<string, number>();
  for (const l of linhas.filter((x) => x.decisao === "PENDENTE")) pendentes.set(l.produto, (pendentes.get(l.produto) ?? 0) + 1);
  if (pendentes.size > 0) {
    console.log("\nProdutos que precisam de \"1 unidade = ? g\" antes de refazer (uso em quantas fichas):");
    for (const [produto, usos] of [...pendentes].sort((a, b) => b[1] - a[1])) console.log(`  - ${produto} (${usos})`);
  }

  if (argumentos.csv && argumentos.csv !== "true") {
    const cabecalho = ["prato", "ativo", "atualizado_em", "produto", "quantidade_hoje", "unidade_hoje", "quantidade_nova", "unidade_nova", "custo_hoje", "custo_novo", "decisao", "motivo"];
    const corpo = linhas.map((l) => [l.prato, l.ativo, l.atualizadoEm, l.produto, l.quantidadeHoje, l.unidadeHoje, l.quantidadeNova, l.unidadeNova, l.custoHoje?.toFixed(4), l.custoNovo?.toFixed(4), l.decisao, l.motivo].map(csv).join(";"));
    fs.writeFileSync(argumentos.csv, `﻿${cabecalho.join(";")}\n${corpo.join("\n")}\n`, "utf8");
    console.log(`\nCSV gravado em ${argumentos.csv} (arquivo local).`);
  }

  await prisma.$disconnect();
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
