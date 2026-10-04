/**
 * Importa o histórico de eventos da planilha do painel (uma linha por evento e dia) para o Painel de Eventos.
 *
 *   npx tsx scripts/importar-painel-eventos.ts --planilha <xlsx> --aba <nome da aba> [--revisao <xlsx>] [--apelidos <json>] [--apply]
 *
 * Sem --apply só lê e mostra o relatório (ensaio). Rodar de novo não duplica: séries pela
 * chave do nome, edições por (série, início), dias por data.
 *
 * Por que não usa o ExcelJS: a aba tem fórmulas arrastadas até a linha 1.048.569 e o
 * readFile estoura a memória. O XML da aba é lido em pedaços e só as células com valor ficam.
 *
 * A planilha guarda uma linha por evento e dia, repetindo o faturamento do restaurante em
 * cada evento do dia. Aqui o faturamento entra UMA vez por data, em OperationDay.
 *
 * Os dados (planilha, revisão, apelidos) ficam fora do repositório, que é público.
 */
import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import unzipper from "unzipper";
import { PrismaClient, Prisma, type EventArea, type EventOrigin } from "@prisma/client";
import { chaveDoEvento, nomeDaSerie, nomeLimpo } from "../src/modules/events/eventos-nome.js";

type Celulas = Record<string, string | number>;
type Linha = { numero: number; celulas: Celulas };

const args = process.argv.slice(2);
const arg = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const APLICAR = args.includes("--apply");
/** Edições: dias da mesma série com até este intervalo viram a mesma edição. */
const INTERVALO_MAXIMO_DIAS = 3;

// ── Leitura do .xlsx ─────────────────────────────────────────────────────

const decodificar = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function lerArquivo(dir: unzipper.CentralDirectory, nome: string): Promise<string> {
  const arquivo = dir.files.find((f) => f.path === nome);
  if (!arquivo) throw new Error(`O arquivo ${nome} não está dentro da planilha.`);
  return (await arquivo.buffer()).toString("utf8");
}

function textosCompartilhados(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodificar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
}

/** Estilos que são data: a planilha guarda data como número de dias desde 1900. */
function estilosDeData(xml: string): Set<number> {
  const formatos: Record<string, string> = {};
  for (const m of xml.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)) formatos[m[1]] = decodificar(m[2]);
  const xfs = xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  const datas = new Set<number>();
  [...xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].forEach((m, i) => {
    const id = Number(m[1]);
    const codigo = formatos[m[1]]?.replace(/\[[^\]]*\]|"[^"]*"/g, "") ?? "";
    if ((id >= 14 && id <= 22) || /[dy]/i.test(codigo)) datas.add(i);
  });
  return datas;
}

async function caminhoDaAba(dir: unzipper.CentralDirectory, aba: string): Promise<string> {
  const workbook = await lerArquivo(dir, "xl/workbook.xml");
  const rels = await lerArquivo(dir, "xl/_rels/workbook.xml.rels");
  const sheet = [...workbook.matchAll(/<sheet name="([^"]*)"[^>]*r:id="([^"]*)"/g)]
    .find((m) => decodificar(m[1]).trim().toUpperCase() === aba);
  if (!sheet) throw new Error(`A aba "${aba}" não existe na planilha.`);
  const alvo = rels.match(new RegExp(`Id="${sheet[2]}"[^>]*Target="([^"]*)"`))?.[1]
    ?? rels.match(new RegExp(`Target="([^"]*)"[^>]*Id="${sheet[2]}"`))?.[1];
  if (!alvo) throw new Error(`Não achei o arquivo da aba "${aba}".`);
  return alvo.startsWith("/") ? alvo.slice(1) : `xl/${alvo}`;
}

const serialParaData = (n: number) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);

async function lerAba(arquivoXlsx: string, aba: string): Promise<Linha[]> {
  const dir = await unzipper.Open.file(arquivoXlsx);
  const textos = textosCompartilhados(await lerArquivo(dir, "xl/sharedStrings.xml").catch(() => ""));
  const datas = estilosDeData(await lerArquivo(dir, "xl/styles.xml"));
  const caminho = await caminhoDaAba(dir, aba);
  const arquivo = dir.files.find((f) => f.path === caminho)!;

  const linhas = new Map<number, Celulas>();
  const celula = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const processar = (trecho: string) => {
    celula.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = celula.exec(trecho))) {
      const dentro = m[4];
      if (!dentro) continue;
      const tipo = m[3].match(/ t="(\w+)"/)?.[1];
      const estilo = Number(m[3].match(/ s="(\d+)"/)?.[1] ?? 0);
      let bruto = dentro.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (bruto === undefined) bruto = dentro.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      if (bruto === undefined || tipo === "e") continue;
      let valor: string | number;
      if (tipo === "s") valor = textos[Number(bruto)] ?? "";
      else if (tipo === "str" || tipo === "inlineStr") valor = decodificar(bruto);
      else {
        const n = Number(bruto);
        valor = datas.has(estilo) && n > 20000 && n < 80000 ? serialParaData(n) : n;
      }
      if (typeof valor === "string" && valor.trim() === "") continue;
      const numero = Number(m[2]);
      const atual = linhas.get(numero) ?? {};
      atual[m[1]] = valor;
      linhas.set(numero, atual);
    }
  };

  // O decodificador segura o pedaço de um acento que ficou cortado na fronteira entre dois blocos.
  const decodificador = new StringDecoder("utf8");
  let resto = "";
  for await (const pedaco of arquivo.stream()) {
    resto += decodificador.write(pedaco as Buffer);
    const fim = resto.lastIndexOf("</row>");
    if (fim < 0) continue;
    processar(resto.slice(0, fim + 6));
    resto = resto.slice(fim + 6);
  }
  processar(resto + decodificador.end());
  return [...linhas.entries()].sort((a, b) => a[0] - b[0]).map(([numero, celulas]) => ({ numero, celulas }));
}

// ── Colunas pelo cabeçalho (a ordem pode mudar quando a planilha for atualizada) ──

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function colunas(linhas: Linha[]) {
  const cabecalho = linhas.find((l) => Object.values(l.celulas).some((v) => normalizar(String(v)) === "EVENTO"));
  if (!cabecalho) throw new Error("Não achei a linha de cabeçalho (coluna EVENTO).");
  const achar = (...nomes: string[]): string | undefined =>
    Object.entries(cabecalho.celulas).find(([, v]) => nomes.includes(normalizar(String(v))))?.[0];
  // Nº ALMOÇO e VLR ALMOÇO, depois Nº JANTAR e VLR JANTAR (os dois "TKT MÉDIO" são fórmulas e ficam de fora).
  const c = {
    evento: achar("EVENTO"),
    contato: achar("CONTATO"),
    data: achar("DATAS", "DATA"),
    inicio: achar("HR INICIO"),
    fim: achar("HR FINAL"),
    publico: achar("PUB ESTIMADO"),
    almocos: achar("N ALMOCO"),
    valorAlmoco: achar("VLR ALMOCO"),
    jantares: achar("N JANTAR"),
    valorJantar: achar("VLR JANTAR"),
    lunchBox: achar("LUNCH IN THE BOX"),
    precoBuffet: achar("VLR BUFFET"),
    comentario: achar("COMENTARIOS GERENCIA"),
  };
  for (const [nome, letra] of Object.entries(c)) {
    if (!letra && ["evento", "data", "almocos", "valorAlmoco"].includes(nome)) throw new Error(`Coluna obrigatória não encontrada: ${nome}.`);
  }
  return { cabecalhoLinha: cabecalho.numero, ...c };
}

// ── Revisão do gestor (comentários deslocados e ajustes) ──

type Revisao = { mover: Map<number, number>; descartar: Set<number>; pendentes: number[] };

async function lerRevisao(arquivo: string | undefined): Promise<Revisao> {
  const revisao: Revisao = { mover: new Map(), descartar: new Set(), pendentes: [] };
  if (!arquivo) return revisao;
  const dir = await unzipper.Open.file(arquivo);
  const textos = textosCompartilhados(await lerArquivo(dir, "xl/sharedStrings.xml").catch(() => ""));
  const valor = (xml: string, ref: string) => {
    const m = xml.match(new RegExp(`<c r="${ref}"([^>]*?)>([\\s\\S]*?)</c>`));
    if (!m) return "";
    const v = m[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? m[2].match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
    return / t="s"/.test(m[1]) ? textos[Number(v)] ?? "" : decodificar(v);
  };
  // Aba 1: A = linha atual, D = linha proposta, I = decisão.
  const aba1 = await lerArquivo(dir, "xl/worksheets/sheet1.xml");
  for (let r = 5; r < 200; r++) {
    const atual = Number(valor(aba1, `A${r}`));
    if (!Number.isInteger(atual) || atual <= 0) continue;
    const decisao = normalizar(valor(aba1, `I${r}`));
    if (decisao === "MOVER") revisao.mover.set(atual, Number(valor(aba1, `D${r}`)));
    else if (decisao === "DESCARTAR") revisao.descartar.add(atual);
    else if (decisao !== "MANTER") revisao.pendentes.push(atual);
  }
  // Aba 2: só as linhas com número único em A e decisão Descartar.
  const aba2 = await lerArquivo(dir, "xl/worksheets/sheet2.xml").catch(() => "");
  for (let r = 4; r < 100 && aba2; r++) {
    const atual = Number(valor(aba2, `A${r}`));
    if (Number.isInteger(atual) && atual > 0 && normalizar(valor(aba2, `F${r}`)) === "DESCARTAR") revisao.descartar.add(atual);
  }
  return revisao;
}

// ── Apelidos: nomes diferentes da mesma série e a origem de cada uma ──

type Apelidos = { juntar: Record<string, string>; origem: Record<string, EventOrigin>; nome: Record<string, string> };

function lerApelidos(arquivo: string | undefined): Apelidos {
  if (!arquivo) return { juntar: {}, origem: {}, nome: {} };
  const bruto = JSON.parse(fs.readFileSync(arquivo, "utf8")) as Partial<Apelidos>;
  return { juntar: bruto.juntar ?? {}, origem: bruto.origem ?? {}, nome: bruto.nome ?? {} };
}

const AREAS: Array<[EventArea, RegExp]> = [
  ["SAUDE", /CONGR|MEDIC|SIMPOSIO|JORNADA|OBES|NUTRI|ONCO|DERMA|PEDIAT|OFTAL|NEURO|GERIAT|INFECTO|ORTOMOLEC|MASTO|ULTRASSON|FISIO|REUMATO|PALIAT|INJETAV|OTORRINO|IMUNI|ENDOCRINO|SAUDE|ALZHEIMER|TIREOIDE|AUDIOLOG|PROTESES|FONOAUD|SONO|PODOLOG|ALERGIA/],
  ["JURIDICO", /LAW|JURI|LAWTECH/],
  ["FINANCEIRO", /TAX|FISCAL|TRIBUT|CONTABIL|INVESTIMENTO|CREDI|PAYMENT|FINANC/],
  ["TECNOLOGIA", /TECH|DIGITAL|AGILE|SMART|PRODUCT|COMMERCE|ECOM|SUMMIT|AI |PROJECT/],
  ["FEIRA_VAREJO", /EXPO|FEIRA|BIJOIAS|SHOWROOM|FASHION/],
  ["EDUCACAO", /ESTUDANTE|BIBLIOTECA|SEMINARIO/],
  ["ENTRETENIMENTO", /TEATRO|BROADWAY|FEST|GAMES/],
];

function areaDe(nome: string): EventArea {
  const n = normalizar(nome);
  return AREAS.find(([, re]) => re.test(n))?.[0] ?? "OUTRO";
}

// ── Montagem ──

type DiaEvento = { linha: number; data: string; nome: string; chave: string; inicio?: string; fim?: string; publico?: number; contato?: string };
type DiaRestaurante = {
  almocos?: number; valorAlmoco?: number; jantares?: number; valorJantar?: number; precoBuffet?: number; comentarios: string[];
};

const horario = (v: unknown) => {
  if (typeof v !== "number" || v <= 0 || v >= 1) return undefined;
  const minutos = Math.round(v * 24 * 60);
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
};
const numero = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const texto = (v: unknown) => (v === undefined ? undefined : String(v).replace(/\s+/g, " ").trim() || undefined);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const ehSimNao = (s: string) => /^(SIM|NAO)$/.test(normalizar(s));

async function main() {
  const planilha = arg("--planilha");
  if (!planilha || !fs.existsSync(planilha)) throw new Error("Informe --planilha com o caminho do .xlsx.");
  const aba = arg("--aba")?.trim().toUpperCase();
  if (!aba) throw new Error("Informe --aba com o nome da aba que tem uma linha por evento e dia.");
  const revisao = await lerRevisao(arg("--revisao"));
  const apelidos = lerApelidos(arg("--apelidos"));

  console.log(`Lendo ${path.basename(planilha)} (aba ${aba})…`);
  const linhas = await lerAba(planilha, aba);
  const c = colunas(linhas);

  const eventos: DiaEvento[] = [];
  const restaurante = new Map<string, DiaRestaurante>();
  const ignoradas: string[] = [];
  const comentarioDaLinha = new Map<number, string>();

  // Comentários: a coluna de comentários, mais o texto que caiu na coluna LUNCH IN THE BOX.
  for (const l of linhas) {
    if (l.numero <= c.cabecalhoLinha) continue;
    const partes = [c.comentario && texto(l.celulas[c.comentario]), c.lunchBox && texto(l.celulas[c.lunchBox])]
      .filter((s): s is string => Boolean(s) && !ehSimNao(s as string));
    if (partes.length) comentarioDaLinha.set(l.numero, partes.join(" "));
  }
  const comentarioFinal = new Map<number, string>();
  for (const [linha, comentario] of comentarioDaLinha) {
    if (revisao.descartar.has(linha) || revisao.pendentes.includes(linha)) continue;
    const destino = revisao.mover.get(linha) ?? linha;
    // Na movida, o comentário da linha de destino só é sobrescrito se ela não tiver um próprio.
    if (!comentarioFinal.has(destino) || revisao.mover.has(linha)) comentarioFinal.set(destino, comentario);
  }

  for (const l of linhas) {
    if (l.numero <= c.cabecalhoLinha) continue;
    const nome = texto(l.celulas[c.evento!]);
    const data = l.celulas[c.data!];
    if (!nome) continue;
    if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      ignoradas.push(`linha ${l.numero}: "${nome}" sem data`);
      continue;
    }
    const chaveBruta = chaveDoEvento(nome);
    if (!chaveBruta) {
      ignoradas.push(`linha ${l.numero}: "${nome}" sem nome reconhecível`);
      continue;
    }
    const chave = apelidos.juntar[chaveBruta] ?? chaveBruta;
    eventos.push({
      linha: l.numero, data, nome, chave,
      inicio: horario(c.inicio && l.celulas[c.inicio]),
      fim: horario(c.fim && l.celulas[c.fim]),
      publico: numero(c.publico && l.celulas[c.publico]),
      contato: c.contato ? texto(l.celulas[c.contato]) : undefined,
    });

    const dia = restaurante.get(data) ?? { comentarios: [] };
    // Faturamento do dia: o primeiro preenchido vale; nas outras linhas do mesmo dia é repetição.
    if (dia.almocos === undefined && numero(l.celulas[c.almocos!]) !== undefined) {
      dia.almocos = numero(l.celulas[c.almocos!]);
      dia.valorAlmoco = numero(l.celulas[c.valorAlmoco!]);
      dia.jantares = c.jantares ? numero(l.celulas[c.jantares]) : undefined;
      dia.valorJantar = c.valorJantar ? numero(l.celulas[c.valorJantar]) : undefined;
    }
    if (dia.jantares === undefined && c.jantares && numero(l.celulas[c.jantares]) !== undefined) {
      dia.jantares = numero(l.celulas[c.jantares]);
      dia.valorJantar = c.valorJantar ? numero(l.celulas[c.valorJantar]) : undefined;
    }
    if (dia.precoBuffet === undefined && c.precoBuffet) dia.precoBuffet = numero(l.celulas[c.precoBuffet]);
    const comentario = comentarioFinal.get(l.numero);
    if (comentario && !dia.comentarios.includes(comentario)) dia.comentarios.push(comentario);
    restaurante.set(data, dia);
  }

  const prisma = new PrismaClient();
  try {
    // Séries que já existem, pela chave e pelas chaves de séries juntadas a elas pela tela.
    const existentes = await prisma.eventSeries.findMany({ select: { id: true, nameKey: true, aliasKeys: true } });
    const idDaChave = new Map<string, string>();
    for (const s of existentes) {
      idDaChave.set(s.nameKey, s.id);
      for (const a of s.aliasKeys) idDaChave.set(a, s.id);
    }
    // Duas chaves que apontam para a mesma série viram um grupo só: senão nasceriam duas edições
    // da mesma série nos mesmos dias, e a previsão contaria "dois eventos" no dia.
    const grupoDe = (chave: string) => (idDaChave.has(chave) ? `id:${idDaChave.get(chave)}` : chave);

    // Edições: dias da mesma série perto um do outro.
    type Edicao = { grupo: string; dias: DiaEvento[] };
    const porSerie = new Map<string, DiaEvento[]>();
    for (const e of eventos) porSerie.set(grupoDe(e.chave), [...(porSerie.get(grupoDe(e.chave)) ?? []), e]);
    const edicoes: Edicao[] = [];
    for (const [grupo, dias] of porSerie) {
      const ordenados = [...dias].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.linha - b.linha));
      let atual: Edicao | null = null;
      for (const d of ordenados) {
        const ultimo = atual?.dias[atual.dias.length - 1];
        if (!atual || !ultimo || diasEntre(ultimo.data, d.data) > INTERVALO_MAXIMO_DIAS) {
          atual = { grupo, dias: [] };
          edicoes.push(atual);
        }
        // Mesmo evento duas vezes no mesmo dia (nome escrito de dois jeitos): fica uma.
        if (!atual.dias.some((x) => x.data === d.data)) atual.dias.push(d);
      }
    }

    // Lançamento do Salão digitado à mão (sem número de pessoas) não conta como PDV: nesses dias
    // o histórico da planilha continua valendo. É o mesmo critério da tela (realizadoPorData).
    const comPdv = new Set(
      (await prisma.$queryRaw<Array<{ d: string }>>`
        SELECT DISTINCT "date"::date::text AS d FROM "RevenueEntry"
        WHERE "channel" = 'Salão' AND "status" = 'ACTIVE' AND "peopleFirstShift" IS NOT NULL`).map((r) => r.d),
    );
    const datas = [...restaurante.keys()].sort();
    const comFaturamento = datas.filter((d) => restaurante.get(d)!.almocos !== undefined || restaurante.get(d)!.jantares !== undefined);
    const legado = comFaturamento.filter((d) => !comPdv.has(d));

    console.log("\n── Relatório ──");
    console.log(`Linhas de evento: ${eventos.length} · séries: ${porSerie.size} · edições: ${edicoes.length} · datas: ${datas.length}`);
    for (const ano of [...new Set(datas.map((d) => d.slice(0, 4)))]) {
      const doAno = comFaturamento.filter((d) => d.startsWith(ano));
      const almocos = doAno.reduce((s, d) => s + (restaurante.get(d)!.almocos ?? 0), 0);
      const valor = doAno.reduce((s, d) => s + (restaurante.get(d)!.valorAlmoco ?? 0) + (restaurante.get(d)!.valorJantar ?? 0), 0);
      const doPdv = doAno.filter((d) => comPdv.has(d)).length;
      console.log(`  ${ano}: ${datas.filter((d) => d.startsWith(ano)).length} datas com evento, ${doAno.length} com faturamento na planilha` +
        ` (${almocos} almoços, R$ ${valor.toFixed(2)} sem os 10%)${doPdv ? ` — ${doPdv} já vêm do PDV e não são gravadas` : ""}`);
    }
    console.log(`Faturamento gravado como histórico (antes do PDV): ${legado.length} datas`);
    console.log(`Comentários: ${[...restaurante.values()].reduce((s, d) => s + d.comentarios.length, 0)} em ${[...restaurante.values()].filter((d) => d.comentarios.length).length} datas` +
      ` · movidos pela revisão: ${revisao.mover.size} · descartados: ${revisao.descartar.size} · pendentes (não importados): ${revisao.pendentes.length ? revisao.pendentes.join(", ") : "nenhum"}`);
    if (ignoradas.length) console.log(`Ignoradas: ${ignoradas.join("; ")}`);

    if (!APLICAR) {
      console.log("\nEnsaio: nada foi gravado. Rode com --apply para gravar.");
      return;
    }

    let seriesNovas = 0;
    const idDoGrupo = new Map<string, string>();
    for (const [grupo, dias] of porSerie) {
      if (grupo.startsWith("id:")) {
        idDoGrupo.set(grupo, grupo.slice(3));
        continue;
      }
      const nomeMaisRecente = [...dias].sort((a, b) => (a.data < b.data ? 1 : -1))[0].nome;
      const nome = apelidos.nome[grupo] ?? nomeDaSerie(nomeMaisRecente.split(/\s[-–]\s/)[0]);
      const origem = apelidos.origem[grupo] ?? (/TEATRO/.test(normalizar(nomeMaisRecente)) ? "TEATRO" : "CENTRO_CONVENCOES");
      const criada = await prisma.eventSeries.create({
        data: { name: nome, nameKey: grupo, origin: origem, area: origem === "CENTRO_CONVENCOES" ? areaDe(dias.map((d) => d.nome).join(" ")) : origem === "TEATRO" ? "ENTRETENIMENTO" : "OUTRO" },
      });
      idDoGrupo.set(grupo, criada.id);
      seriesNovas++;
    }

    const dataUtc = (s: string) => new Date(`${s}T00:00:00Z`);
    let edicoesNovas = 0;
    let diasGravados = 0;
    for (const ed of edicoes) {
      const seriesId = idDoGrupo.get(ed.grupo)!;
      const inicio = ed.dias[0].data;
      const fim = ed.dias[ed.dias.length - 1].data;
      const publicos = ed.dias.map((d) => d.publico).filter((p): p is number => typeof p === "number" && p > 0);
      const publico = publicos.length ? Math.max(...publicos) : null;
      const contato = ed.dias.map((d) => d.contato).find(Boolean) ?? null;

      // A edição pode já existir: lançada da circular ou de uma importação anterior, com outro
      // início. Vale a que cruza com estes dias; da planilha só entra o que estiver em branco,
      // para não desfazer o que a gerência corrigiu no ERP.
      const existente = await prisma.eventEdition.findFirst({
        where: { seriesId, startDate: { lte: dataUtc(fim) }, endDate: { gte: dataUtc(inicio) } },
        orderBy: { startDate: "asc" },
      });
      const edicao = existente
        ? await prisma.eventEdition.update({
            where: { id: existente.id },
            data: {
              endDate: existente.endDate < dataUtc(fim) ? dataUtc(fim) : existente.endDate,
              ...(existente.announcedAudience == null && publico ? { announcedAudience: publico } : {}),
              ...(existente.contact == null && contato ? { contact: contato } : {}),
            },
          })
        : await prisma.eventEdition.create({
            data: { seriesId, title: nomeLimpo(ed.dias[0].nome), startDate: dataUtc(inicio), endDate: dataUtc(fim), announcedAudience: publico, contact: contato, source: "PLANILHA" },
          });
      if (!existente) edicoesNovas++;

      for (const d of ed.dias) {
        const chaveDia = { editionId_date: { editionId: edicao.id, date: dataUtc(d.data) } };
        const diaAtual = await prisma.eventEditionDay.findUnique({ where: chaveDia });
        if (!diaAtual) {
          await prisma.eventEditionDay.create({ data: { editionId: edicao.id, date: dataUtc(d.data), startTime: d.inicio ?? null, endTime: d.fim ?? null } });
        } else if ((diaAtual.startTime == null && d.inicio) || (diaAtual.endTime == null && d.fim)) {
          await prisma.eventEditionDay.update({
            where: chaveDia,
            data: { startTime: diaAtual.startTime ?? d.inicio ?? null, endTime: diaAtual.endTime ?? d.fim ?? null },
          });
        }
        diasGravados++;
      }
    }

    let diasOperacao = 0;
    for (const [data, d] of restaurante) {
      const date = dataUtc(data);
      const historico = comPdv.has(data) ? {} : {
        legacyLunchPeople: d.almocos ?? null,
        legacyLunchSales: d.valorAlmoco !== undefined ? new Prisma.Decimal(d.valorAlmoco.toFixed(2)) : null,
        legacyDinnerPeople: d.jantares ?? null,
        legacyDinnerSales: d.valorJantar !== undefined ? new Prisma.Decimal(d.valorJantar.toFixed(2)) : null,
      };
      const atual = await prisma.operationDay.findUnique({ where: { date } });
      // O que a gerência já editou no ERP (comentário, preço) não é sobrescrito pela planilha.
      const notas = d.comentarios.length ? d.comentarios.join("\n") : null;
      await prisma.operationDay.upsert({
        where: { date },
        create: { date, ...historico, buffetPrice: d.precoBuffet ?? null, notes: notas },
        update: { ...historico, ...(atual?.buffetPrice == null && d.precoBuffet ? { buffetPrice: d.precoBuffet } : {}), ...(atual?.notes ? {} : { notes: notas }) },
      });
      diasOperacao++;
    }
    console.log(`\nGravado: ${seriesNovas} séries novas, ${edicoesNovas} edições novas (${edicoes.length} no total), ${diasGravados} dias de evento, ${diasOperacao} dias do restaurante.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`ERRO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
