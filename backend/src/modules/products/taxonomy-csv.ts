/**
 * Leitura estrita do arquivo de decisões da reclassificação. Estrito de propósito: um arquivo estragado não
 * pode virar "aplica só um pedaço das decisões" em silêncio.
 */
import { PRODUCT_NATURES, type ProductNatureValue } from "./product-nature.js";
import type { DecisionRow } from "./taxonomy-plan.js";

/** CSV do Excel em português: ponto e vírgula, aspas duplas só no início do campo, BOM opcional. */
export function lerCsv(bruto: string): string[][] {
  if (bruto.includes("�")) {
    throw new Error("O arquivo não está em UTF-8 (há caracteres inválidos). Salve o CSV como UTF-8 e tente de novo.");
  }
  const texto = bruto.replace(/^﻿/, "");
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let entreAspas = false;
  let inicioDeCampo = true;
  const fecharCampo = () => {
    linha.push(campo);
    campo = "";
    inicioDeCampo = true;
  };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') entreAspas = false;
      else campo += c;
    } else if (c === '"' && inicioDeCampo) {
      entreAspas = true;
      inicioDeCampo = false;
    } else if (c === ";") fecharCampo();
    else if (c === "\r") continue;
    else if (c === "\n") { fecharCampo(); linhas.push(linha); linha = []; }
    else { campo += c; inicioDeCampo = false; }
  }
  if (entreAspas) throw new Error("O arquivo termina dentro de aspas: há um campo sem fechamento.");
  if (campo || linha.length) { fecharCampo(); linhas.push(linha); }
  return linhas.filter((l) => l.some((valor) => valor.trim() !== ""));
}

export function lerDecisoes(bruto: string): DecisionRow[] {
  const [cabecalho, ...dados] = lerCsv(bruto);
  if (!cabecalho) throw new Error("Arquivo de decisões vazio.");
  const indice = (nome: string) => {
    const i = cabecalho.indexOf(nome);
    if (i < 0) throw new Error(`Coluna "${nome}" não encontrada no arquivo de decisões.`);
    return i;
  };
  const [iCodigo, iNatureza, iCategoria] = [indice("codigo"), indice("natureza"), indice("categoria")];
  const decisoes: DecisionRow[] = [];
  dados.forEach((linha, posicao) => {
    if (linha.length !== cabecalho.length) {
      throw new Error(`Linha ${posicao + 2} do arquivo tem ${linha.length} colunas; o cabeçalho tem ${cabecalho.length}.`);
    }
    const natureza = linha[iNatureza].trim();
    if (natureza && !(PRODUCT_NATURES as readonly string[]).includes(natureza)) {
      throw new Error(`Natureza inválida "${natureza}" no código ${linha[iCodigo]}.`);
    }
    const codigo = linha[iCodigo].trim();
    const categoria = linha[iCategoria].trim();
    if (!codigo) {
      // Produto sem código não tem como ser casado. Só é aceito quando a decisão é "não classificar".
      if (natureza || categoria) throw new Error(`Linha ${posicao + 2} do arquivo tem decisão, mas está sem código.`);
      return;
    }
    decisoes.push({ codigo, nature: (natureza || null) as ProductNatureValue | null, category: categoria || null });
  });
  return decisoes;
}
