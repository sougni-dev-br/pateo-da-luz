// Importa o Cartão de Ponto do RHiD (CSV) para quem bate ponto no relógio: grava as batidas (coletadas e
// incluídas à mão) e traduz Folga, Feriado, Banco, Falta e justificativas para a Escala do ERP.
// Quem lança papel continua mandando pela Escala; aqui só entram as pessoas que estão no arquivo.
//
// Sem confirmar, devolve a PRÉVIA (nada é gravado). Confirmando, grava dentro da trava do mês, respeitando
// o ponto fechado e o período financeiro fechado.

import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { assertPeriodWritableForRange } from "../cmv-real/cmv-real.service.js";
import { type DiaDoCartao, type TipoDoCartao, lerCartaoPonto } from "./cartao-ponto-parser.js";
import { PontoRecusa } from "./ponto.service.js";
import { chaveTravaMes, foiGravadoPeloPonto, notaDoPonto, tipoAnteriorDoPonto, travarMeses } from "./ponto-trava.js";

type Tx = Prisma.TransactionClient;

const LIMITE_LINHAS = 20_000;
const LIMITE_MUDANCAS_NA_PREVIA = 300;
const TAMANHO_LOTE = 150;
const PRIMEIRO_DIA_ACEITO = "2020-01-01";

const isoDia = (d: Date) => d.toISOString().slice(0, 10);
const diaDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const soDigitos = (s: string) => s.replace(/\D/g, "");
const hojeSaoPaulo = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const nomeDe = (e: { firstName: string; lastName: string; displayName: string | null }) => e.displayName?.trim() || `${e.firstName} ${e.lastName}`.trim();

// ─── Regra de decisão da Escala (pura) ──────────────────────────────────────────

export type AcaoEscala =
  | { acao: "criar"; para: TipoDoCartao }
  | { acao: "trocar"; de: string; para: TipoDoCartao }
  | { acao: "igual" }
  | { acao: "manter"; atual: string; motivo: string };

const SO_O_ERP_SABE: ReadonlySet<string> = new Set(["FERIAS", "ATESTADO", "AFASTAMENTO"]);
const FOLGAS: ReadonlySet<string> = new Set(["FOLGA", "FOLGA_FERIADO", "FOLGA_BANCO_HORAS"]);

/**
 * O RHiD manda para quem bate ponto nele, com duas proteções: férias, atestado e afastamento lançados no ERP não são
 * trocados por uma folga (o RHiD pode simplesmente não saber deles), e a falta só entra onde a Escala dizia turno ou evento.
 */
export function decidirEscala(alvo: TipoDoCartao, atual: string | null): AcaoEscala {
  if (atual === null) return { acao: "criar", para: alvo };
  if (atual === alvo) return { acao: "igual" };
  if (alvo === "FALTA") {
    return atual === "TURNO" || atual === "EVENTO" ? { acao: "trocar", de: atual, para: alvo } : { acao: "manter", atual, motivo: "A Escala diz outra coisa e o RHiD marcou falta: confira." };
  }
  if (SO_O_ERP_SABE.has(atual) && FOLGAS.has(alvo)) {
    return { acao: "manter", atual, motivo: "Já está lançado no ERP; o RHiD só mostra folga." };
  }
  return { acao: "trocar", de: atual, para: alvo };
}

// ─── Resultado ──────────────────────────────────────────────────────────────────

export interface MudancaCartao {
  nome: string;
  data: string;
  de: string | null;
  para: string;
  motivo?: string;
}

export interface ResultadoCartao {
  gravado: boolean;
  pessoas: number;
  diasLidos: number;
  de: string | null;
  ate: string | null;
  batidas: { gravar: number; iguais: number; conflitos: number };
  escala: { criar: number; trocar: number; iguais: number; mantidos: number };
  mesesFechados: number;
  cpfsSemCadastro: string[];
  desconhecidos: string[];
  avisos: string[];
  mudancas: MudancaCartao[];
  mantidos: MudancaCartao[];
}

interface PessoaDoArquivo {
  id: string;
  nome: string;
  admissao: string | null;
  desligamento: string | null;
}

interface DiaPlanejado {
  pessoa: PessoaDoArquivo;
  dia: DiaDoCartao;
}

const chaveDia = (employeeId: string, data: string) => `${employeeId}|${data}`;

// ─── Núcleo: lê, decide e (se confirmado) grava ─────────────────────────────────

export async function importarCartaoPonto(texto: string, userId: string, confirmar: boolean): Promise<ResultadoCartao> {
  const leitura = lerCartaoPonto(texto);
  if (leitura.dias.length > LIMITE_LINHAS) throw new PontoRecusa(413, "O arquivo tem linhas demais. Exporte um período menor.");
  const vazio = (extra: Partial<ResultadoCartao> = {}): ResultadoCartao => ({
    gravado: false, pessoas: 0, diasLidos: leitura.dias.length, de: null, ate: null,
    batidas: { gravar: 0, iguais: 0, conflitos: 0 }, escala: { criar: 0, trocar: 0, iguais: 0, mantidos: 0 },
    mesesFechados: 0, cpfsSemCadastro: [], desconhecidos: leitura.desconhecidos, avisos: leitura.avisos, mudancas: [], mantidos: [], ...extra,
  });
  if (leitura.dias.length === 0) return vazio();

  const funcionarios = await prisma.employee.findMany({
    where: { deletedAt: null, registraPonto: true },
    select: { id: true, cpf: true, firstName: true, lastName: true, displayName: true, admissionDate: true, terminationDate: true },
  });
  const porCpf = new Map<string, PessoaDoArquivo>(
    funcionarios.map((f) => [soDigitos(f.cpf), { id: f.id, nome: nomeDe(f), admissao: f.admissionDate ? isoDia(f.admissionDate) : null, desligamento: f.terminationDate ? isoDia(f.terminationDate) : null }]),
  );

  const hoje = hojeSaoPaulo();
  const semCadastro = new Set<string>();
  const planejados: DiaPlanejado[] = [];
  const avisos = [...leitura.avisos];
  let ignorados = 0;
  for (const dia of leitura.dias) {
    const pessoa = porCpf.get(dia.cpf);
    if (!pessoa) {
      semCadastro.add(dia.nome || "pessoa sem nome");
      continue;
    }
    const fora = dia.data < PRIMEIRO_DIA_ACEITO || dia.data > hoje || (pessoa.admissao && dia.data < pessoa.admissao) || (pessoa.desligamento && dia.data > pessoa.desligamento);
    if (fora) ignorados += 1;
    else if (dia.marcacoes.length > 0 || dia.tipo) planejados.push({ pessoa, dia });
  }
  if (ignorados > 0) avisos.push(`${ignorados} ${ignorados === 1 ? "dia ignorado" : "dias ignorados"}: data futura, antes da admissão ou depois do desligamento.`);
  if (planejados.length === 0) return vazio({ cpfsSemCadastro: [...semCadastro], avisos });

  const datas = planejados.map((p) => p.dia.data).sort();
  const [de, ate] = [datas[0], datas[datas.length - 1]];
  const ids = [...new Set(planejados.map((p) => p.pessoa.id))];

  const resultado = vazio({ pessoas: ids.length, de, ate, cpfsSemCadastro: [...semCadastro], avisos });
  const lerEstado = async (cliente: Pick<Tx, "pontoDia" | "employeeScheduleDay" | "pontoFechamento">, planos: DiaPlanejado[]) => {
    const idsLote = [...new Set(planos.map((p) => p.pessoa.id))];
    const dMin = planos.reduce((m, p) => (p.dia.data < m ? p.dia.data : m), "9999-12-31");
    const dMax = planos.reduce((m, p) => (p.dia.data > m ? p.dia.data : m), "0000-01-01");
    const [pontos, escala, fechamentos] = await Promise.all([
      cliente.pontoDia.findMany({ where: { employeeId: { in: idsLote }, date: { gte: diaDate(dMin), lte: diaDate(dMax) } } }),
      cliente.employeeScheduleDay.findMany({ where: { employeeId: { in: idsLote }, date: { gte: diaDate(dMin), lte: diaDate(dMax) } } }),
      cliente.pontoFechamento.findMany({ where: { employeeId: { in: idsLote }, status: "FECHADO" }, select: { employeeId: true, year: true, month: true } }),
    ]);
    return {
      pontos: new Map(pontos.map((p) => [chaveDia(p.employeeId, isoDia(p.date)), p])),
      escala: new Map(escala.map((e) => [chaveDia(e.employeeId, isoDia(e.date)), e])),
      fechados: new Set(fechamentos.map((f) => `${f.employeeId}|${f.year}|${f.month}`)),
    };
  };

  type Estado = Awaited<ReturnType<typeof lerEstado>>;
  const mesFechado = (e: Estado, p: DiaPlanejado) => e.fechados.has(`${p.pessoa.id}|${Number(p.dia.data.slice(0, 4))}|${Number(p.dia.data.slice(5, 7))}`);

  // Decide tudo de um dia sobre o estado atual; devolve o que gravar e já conta no resultado.
  const decidir = (e: Estado, p: DiaPlanejado, contar: boolean) => {
    const chave = chaveDia(p.pessoa.id, p.dia.data);
    const acoes: { ponto?: string[]; escala?: { alvo: TipoDoCartao; atual: string | null; antes: string | null } } = {};
    if (mesFechado(e, p)) {
      if (contar) resultado.mesesFechados += 1;
      return acoes;
    }
    if (p.dia.marcacoes.length > 0) {
      const atual = e.pontos.get(chave);
      if (atual && (atual.editadoManual || atual.origem === "PAPEL")) {
        if (contar) resultado.batidas.conflitos += 1;
      } else if (atual && atual.marcacoes.join(",") === p.dia.marcacoes.join(",")) {
        if (contar) resultado.batidas.iguais += 1;
      } else {
        acoes.ponto = p.dia.marcacoes;
        if (contar) resultado.batidas.gravar += 1;
      }
    }
    if (p.dia.tipo) {
      const marca = e.escala.get(chave);
      const decisao = decidirEscala(p.dia.tipo, marca?.type ?? null);
      const rotuloAtual = marca?.type ?? null;
      if (decisao.acao === "igual") {
        if (contar) resultado.escala.iguais += 1;
      } else if (decisao.acao === "manter") {
        if (contar) {
          resultado.escala.mantidos += 1;
          if (resultado.mantidos.length < LIMITE_MUDANCAS_NA_PREVIA) resultado.mantidos.push({ nome: p.pessoa.nome, data: p.dia.data, de: decisao.atual, para: p.dia.tipo, motivo: decisao.motivo });
        }
      } else {
        const antesDoPonto = rotuloAtual === "TURNO" || rotuloAtual === "EVENTO" ? rotuloAtual : tipoAnteriorDoPonto(marca?.notes);
        acoes.escala = { alvo: p.dia.tipo, atual: rotuloAtual, antes: antesDoPonto };
        if (contar) {
          if (decisao.acao === "criar") resultado.escala.criar += 1;
          else resultado.escala.trocar += 1;
          if (resultado.mudancas.length < LIMITE_MUDANCAS_NA_PREVIA) resultado.mudancas.push({ nome: p.pessoa.nome, data: p.dia.data, de: rotuloAtual, para: p.dia.tipo });
        }
      }
    }
    return acoes;
  };

  // Prévia: nada é gravado.
  const estadoPrevia = await lerEstado(prisma, planejados);
  for (const p of planejados) decidir(estadoPrevia, p, true);
  resultado.mudancas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || a.data.localeCompare(b.data));
  if (!confirmar) return resultado;

  try {
    await assertPeriodWritableForRange(diaDate(de), diaDate(ate), "Importação do cartão de ponto");
  } catch (err) {
    throw new PontoRecusa(409, err instanceof Error ? err.message : "Período fechado.");
  }

  for (let i = 0; i < planejados.length; i += TAMANHO_LOTE) {
    const lote = planejados.slice(i, i + TAMANHO_LOTE);
    const meses = [...new Set(lote.map((p) => p.dia.data.slice(0, 7)))].map((m) => chaveTravaMes(Number(m.slice(0, 4)), Number(m.slice(5, 7))));
    await prisma.$transaction(async (tx) => {
      await travarMeses(tx, meses);
      const estado = await lerEstado(tx, lote); // tudo refeito já dentro da trava
      for (const p of lote) {
        const acoes = decidir(estado, p, false);
        const date = diaDate(p.dia.data);
        if (acoes.ponto) {
          await tx.pontoDia.upsert({
            where: { employeeId_date: { employeeId: p.pessoa.id, date } },
            create: { employeeId: p.pessoa.id, date, origem: "RELOGIO", marcacoes: acoes.ponto, createdById: userId },
            update: { marcacoes: acoes.ponto },
          });
          const falta = estado.escala.get(chaveDia(p.pessoa.id, p.dia.data));
          if (falta?.type === "FALTA" && foiGravadoPeloPonto(falta.notes)) {
            const antes = tipoAnteriorDoPonto(falta.notes);
            if (antes === "TURNO" || antes === "EVENTO") await tx.employeeScheduleDay.update({ where: { id: falta.id }, data: { type: antes, notes: null } });
            else await tx.employeeScheduleDay.delete({ where: { id: falta.id } });
          }
        }
        if (acoes.escala) {
          const { alvo, antes } = acoes.escala;
          await tx.employeeScheduleDay.upsert({
            where: { employeeId_date: { employeeId: p.pessoa.id, date } },
            create: { employeeId: p.pessoa.id, date, type: alvo, notes: notaDoPonto(antes), createdById: userId },
            update: { type: alvo, notes: notaDoPonto(antes) },
          });
        }
      }
    }, { timeout: 60_000, maxWait: 10_000 });
  }
  resultado.gravado = true;
  return resultado;
}
