// Calibracao da leitura de documentos: roda a extracao real em PDFs do disco e
// imprime o rascunho + avisos. NUNCA grava.
//
//   npx tsx scripts/testar-doc-intake.ts nota.pdf boleto.pdf
//   npx tsx scripts/testar-doc-intake.ts --banco nota.pdf   (cruza com o cadastro; so SELECT)
import "dotenv/config";
import fs from "node:fs";
import { prisma } from "../src/config/database.js";
import { agruparTitulos } from "../src/modules/doc-intake/agrupamento-titulos.js";
import { enriquecerDocumento, type DocumentoEnriquecido } from "../src/modules/doc-intake/doc-enrich.service.js";
import { extrairDocumento } from "../src/modules/doc-intake/doc-extract.service.js";
import { createLlmProvider } from "../src/modules/doc-intake/llm.provider.js";

function imprimir(doc: DocumentoEnriquecido, comBanco: boolean) {
  console.log("\n================================================");
  console.log("ARQUIVO      :", doc.nomeArquivo);
  console.log("TIPO         :", doc.tipoDocumento);
  console.log("EMISSOR      :", doc.emissor.nome, "|", doc.emissor.cnpj, "| CNPJ valido:", doc.emissor.cnpjValido);
  console.log("DESTINATARIO :", doc.destinatario.nome, "|", doc.destinatario.cnpj, "| CNPJ valido:", doc.destinatario.cnpjValido);
  console.log("NUMERO       :", doc.numeroDocumento);
  console.log("EMISSAO      :", doc.dataEmissaoRaw, "->", doc.dataEmissao?.toISOString().slice(0, 10) ?? null);
  console.log("VENCIMENTO   :", doc.dataVencimentoRaw, "->", doc.dataVencimento?.toISOString().slice(0, 10) ?? null);
  console.log("VALOR        :", doc.valorTotalRaw, "->", doc.valorTotal);
  console.log("RUBRICAS     :", doc.rubricas.map((r) => `${r.descricao} = ${r.valor}`).join(" | ") || "(nenhuma)");
  console.log("CHAVE TITULO :", doc.chaveTitulo);
  if (comBanco) {
    console.log("FORNECEDOR   :", doc.fornecedor.cadastrado ? `${doc.fornecedor.nome} (id ${doc.fornecedor.id})` : "NAO CADASTRADO");
    console.log("EMPRESA      :", doc.empresa ? `${doc.empresa.nome} (id ${doc.empresa.id})` : "nao identificada");
    console.log("DUPLICATAS   :", doc.duplicatas.length === 0 ? "nenhuma" : doc.duplicatas.map((d) => `${d.invoiceNumber} R$ ${d.totalAmount} [${d.status}]`).join(" | "));
    console.log("PODE LANCAR  :", doc.podeConfirmar ? "SIM" : "NAO (ha bloqueio)");
  }
  console.log("AVISOS       :", doc.avisos.length === 0 ? "nenhum" : "");
  for (const aviso of doc.avisos) console.log(`   [${aviso.nivel}] ${aviso.codigo}: ${aviso.mensagem}`);
  console.log("TOKENS       :", doc.meta.tokensUsed, "| modelo:", doc.meta.model);
}

async function main() {
  const args = process.argv.slice(2);
  const comBanco = args.includes("--banco");
  const forcarVisao = args.includes("--visao");
  const arquivos = args.filter((arg) => !arg.startsWith("--"));

  if (arquivos.length === 0) {
    console.error("Uso: npx tsx scripts/testar-doc-intake.ts [--banco] [--visao] <arquivo.pdf> [outro.pdf ...]");
    process.exit(1);
  }

  const provider = createLlmProvider();
  if (!provider) {
    console.error("GEMINI_API_KEY nao configurada no .env");
    process.exit(1);
  }

  const docs: DocumentoEnriquecido[] = [];
  for (const caminho of arquivos) {
    const nomeArquivo = caminho.split(/[\/]/).pop() ?? caminho;
    const extraido = await extrairDocumento({ nomeArquivo, buffer: fs.readFileSync(caminho), provider, forcarVisao });
    const doc = comBanco
      ? await enriquecerDocumento(extraido)
      : { ...extraido, fornecedor: { cadastrado: false as const }, empresa: null, duplicatas: [], podeConfirmar: true };
    docs.push(doc);
    imprimir(doc, comBanco);
  }

  console.log("\n================================================");
  const titulos = agruparTitulos(docs);
  console.log("PAREAMENTO - titulos distintos:", titulos.length, `(de ${docs.length} arquivos)`);
  for (const titulo of titulos) {
    console.log(`  R$ ${titulo.valorTotal} venc ${titulo.dataVencimento?.toISOString().slice(0, 10)} <- ${titulo.documentos.join(" + ")}`);
  }
  console.log("TOKENS TOTAIS:", docs.reduce((acc, doc) => acc + (doc.meta.tokensUsed ?? 0), 0));
}

main()
  .catch((error) => {
    console.error("FALHA:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
