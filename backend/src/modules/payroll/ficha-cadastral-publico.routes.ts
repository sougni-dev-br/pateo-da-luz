// Rotas do link da ficha cadastral — SEM sessão: quem abre é a pessoa que vai ser admitida
// (ou o funcionário atualizando os dados), pelo celular. Montadas antes do requireMenuAccess.
//
// Regras:
// - o código do link só é comparado pelo hash; código malformado nem consulta o banco;
// - com data de nascimento (ou CPF) já conhecida, os dados só aparecem depois de a pessoa
//   confirmá-la; 5 erros seguidos bloqueiam a ficha por 30 minutos;
// - depois de finalizada, o link só diz "recebido" — nenhum dado volta.
import crypto from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { Prisma, type FichaCadastral } from "@prisma/client";
import { prisma } from "../../config/database.js";
import { auditLog } from "../security/security-utils.js";
import { filaLimitada, ipConfiavel, limiteDeRequisicoes } from "../../shared/utils/limite-requisicoes.js";
import {
  ARQUIVOS_OBRIGATORIOS_ADMISSAO, ESCOLARIDADES, ESTADOS_CIVIS, RACAS_CORES, TIPOS_ARQUIVO, UFS,
  faltaParaFinalizar, lerDadosPessoa, verificacaoNecessaria, type DadosPessoa,
} from "./ficha-cadastral-campos.js";
import {
  MAX_TENTATIVAS, acessoValido, bloqueioApos, codigoBemFormado, emitirAcesso, hashCodigo, respostaConfere,
} from "./ficha-cadastral-acesso.js";
import { MAX_ARQUIVOS_POR_FICHA, TAMANHO_MAXIMO, TOTAL_MAXIMO_POR_FICHA, enviarArquivo, nomeSeguro, tipoDoConteudo } from "./ficha-cadastral-arquivo.js";

export const fichaCadastralPublicoRouter = Router();

const QUINZE_MINUTOS = 15 * 60 * 1000;
fichaCadastralPublicoRouter.use(limiteDeRequisicoes({ janelaMs: QUINZE_MINUTOS, maximo: 400, chave: "ficha" }));
// Respostas trazem dados pessoais e a chave de acesso: nada em cache de navegador ou proxy.
fichaCadastralPublicoRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
const limiteUpload = limiteDeRequisicoes({ janelaMs: QUINZE_MINUTOS, maximo: 60, chave: "ficha-upload" });
const limiteVerificacao = limiteDeRequisicoes({ janelaMs: QUINZE_MINUTOS, maximo: 20, chave: "ficha-verificar" });

// Cada upload segura até 8 MB na memória até ir para o banco; o plano do Render tem pouca RAM
// (já houve estouro com importação). Poucos ao mesmo tempo; os outros esperam a vez.
const vezDoUpload = filaLimitada({ maximo: 2, tempoMaximoMs: 2 * 60 * 1000 });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: TAMANHO_MAXIMO, files: 1, fields: 5 } });

const OPCOES = {
  estadosCivis: ESTADOS_CIVIS, racasCores: RACAS_CORES, escolaridades: ESCOLARIDADES, ufs: UFS,
  tiposArquivo: TIPOS_ARQUIVO, arquivosObrigatorios: ARQUIVOS_OBRIGATORIOS_ADMISSAO,
};

type Carregada = { ficha: FichaCadastral; dados: DadosPessoa; liberada: boolean };
type ReqFicha = Request & { ficha?: Carregada };

const EDITAVEL = new Set(["ENVIADA", "PREENCHENDO"]);
const dadosDe = (f: FichaCadastral) => (f.dados ?? {}) as DadosPessoa;
const primeiroNome = (f: FichaCadastral) => f.nomeReferencia.split(" ")[0];

// Acha a ficha pelo código e decide o que a pessoa pode ver. Responde sozinha os casos em que
// o link não serve mais (inexistente, cancelado, vencido).
async function carregar(request: ReqFicha, response: Response, next: NextFunction) {
  const codigo = request.params.codigo;
  const naoEncontrado = () => response.status(404).json({ message: "Link inválido. Confira se copiou o endereço inteiro ou peça um novo ao RH." });
  if (!codigoBemFormado(codigo)) return naoEncontrado();
  const ficha = await prisma.fichaCadastral.findUnique({ where: { tokenHash: hashCodigo(codigo) } });
  if (!ficha) return naoEncontrado();
  if (ficha.status === "CANCELADA") return response.status(410).json({ message: "Este link foi cancelado pelo RH." });
  if (EDITAVEL.has(ficha.status) && ficha.expiraEm.getTime() < Date.now()) {
    return response.status(410).json({ message: "Este link venceu. Peça um novo ao RH." });
  }
  const dados = dadosDe(ficha);
  const liberada = !verificacaoNecessaria(dados) || acessoValido(request.header("x-ficha-acesso"), ficha.id, ficha.tokenHash);
  request.ficha = { ficha, dados, liberada };
  next();
}

function exigeEdicao(request: ReqFicha, response: Response, next: NextFunction) {
  const c = request.ficha!;
  if (!EDITAVEL.has(c.ficha.status)) return response.status(409).json({ message: "Esta ficha já foi enviada ao RH e não pode mais ser alterada." });
  if (!c.liberada) return response.status(401).json({ message: "Confirme seus dados para continuar.", verificacao: verificacaoNecessaria(c.dados) });
  next();
}

async function listaArquivos(fichaId: string) {
  return prisma.fichaCadastralArquivo.findMany({
    where: { fichaId },
    select: { id: true, tipo: true, nomeOriginal: true, mimeType: true, tamanho: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
}

async function estado(c: Carregada) {
  const { ficha, dados } = c;
  // Sem verificação, nem o primeiro nome: quem achou o link não descobre de quem é.
  const base = { status: ficha.status, tipo: ficha.tipo };
  if (!EDITAVEL.has(ficha.status)) return base;
  if (!c.liberada) return { ...base, verificacao: verificacaoNecessaria(dados) };
  const arquivos = await listaArquivos(ficha.id);
  return {
    ...base,
    primeiroNome: primeiroNome(ficha),
    expiraEm: ficha.expiraEm.toISOString(),
    motivoDevolucao: ficha.motivoDevolucao,
    dados,
    arquivos,
    falta: faltaParaFinalizar(dados, arquivos.map((a) => a.tipo), ficha.tipo === "ADMISSAO"),
    opcoes: OPCOES,
    acesso: emitirAcesso(ficha.id, ficha.tokenHash),
  };
}

const rota = "/:codigo";

fichaCadastralPublicoRouter.get(rota, carregar, async (request: ReqFicha, response) => {
  const c = request.ficha!;
  if (!c.ficha.primeiroAcessoEm && EDITAVEL.has(c.ficha.status)) {
    await prisma.fichaCadastral.update({ where: { id: c.ficha.id }, data: { primeiroAcessoEm: new Date() } });
  }
  return response.json(await estado(c));
});

fichaCadastralPublicoRouter.post(`${rota}/verificar`, limiteVerificacao, carregar, async (request: ReqFicha, response) => {
  const c = request.ficha!;
  if (!EDITAVEL.has(c.ficha.status)) return response.json(await estado(c));
  const metodo = verificacaoNecessaria(c.dados);
  if (!metodo) return response.json(await estado({ ...c, liberada: true }));
  if (c.ficha.bloqueadoAte && c.ficha.bloqueadoAte.getTime() > Date.now()) {
    return response.status(429).json({ message: `Muitas tentativas erradas. Tente de novo depois de ${momentoSp(c.ficha.bloqueadoAte)}.` });
  }
  const esperado = String(metodo === "NASCIMENTO" ? c.dados.dataNascimento : c.dados.cpf);
  if (respostaConfere((request.body as Record<string, unknown>)?.resposta, esperado, metodo)) {
    await prisma.fichaCadastral.update({ where: { id: c.ficha.id }, data: { tentativasErradas: 0, bloqueadoAte: null } });
    return response.json(await estado({ ...c, liberada: true }));
  }
  // Incremento no banco, não "lido + 1": tentativas em paralelo contam todas.
  const { tentativasErradas } = await prisma.fichaCadastral.update({
    where: { id: c.ficha.id }, data: { tentativasErradas: { increment: 1 } }, select: { tentativasErradas: true },
  });
  const bloqueadoAte = bloqueioApos(tentativasErradas);
  if (bloqueadoAte) {
    await prisma.fichaCadastral.update({ where: { id: c.ficha.id }, data: { bloqueadoAte } });
    await auditLog({ action: "FICHA_CADASTRAL_BLOQUEADA", entity: "FichaCadastral", entityId: c.ficha.id, ipAddress: ipConfiavel(request), userAgent: String(request.headers["user-agent"] ?? "") });
    return response.status(429).json({ message: `Muitas tentativas erradas. Tente de novo depois de ${momentoSp(bloqueadoAte)}.` });
  }
  const oQue = metodo === "NASCIMENTO" ? "Data de nascimento" : "CPF";
  const restam = MAX_TENTATIVAS - (tentativasErradas % MAX_TENTATIVAS);
  return response.status(401).json({ message: `${oQue} não confere. Restam ${restam} tentativas.`, verificacao: metodo });
});

fichaCadastralPublicoRouter.put(`${rota}/dados`, carregar, exigeEdicao, async (request: ReqFicha, response) => {
  const c = request.ficha!;
  const lido = lerDadosPessoa((request.body ?? {}) as Record<string, unknown>);
  if ("erro" in lido) return response.status(400).json({ message: lido.erro });
  // Data de nascimento e CPF protegem o link: dá para corrigir, não para apagar (sem os dois, o
  // link voltaria a abrir sem confirmação).
  for (const campo of ["dataNascimento", "cpf"] as const) {
    if (campo in lido.dados && lido.dados[campo] == null && c.dados[campo]) {
      return response.status(400).json({ message: campo === "cpf" ? "O CPF não pode ficar em branco." : "A data de nascimento não pode ficar em branco." });
    }
  }
  const dados = { ...c.dados, ...lido.dados };
  // Condição de situação no próprio update: salvar no instante do "Finalizar" (ou de o RH
  // cancelar) não altera ficha que já saiu das mãos da pessoa.
  const r = await prisma.fichaCadastral.updateMany({
    where: { id: c.ficha.id, status: { in: ["ENVIADA", "PREENCHENDO"] } },
    data: { dados: dados as Prisma.InputJsonValue, status: "PREENCHENDO" },
  });
  if (r.count !== 1) return response.status(409).json({ message: "Esta ficha já foi enviada ao RH e não pode mais ser alterada." });
  return response.json(await estado({ ficha: { ...c.ficha, status: "PREENCHENDO" }, dados, liberada: true }));
});

fichaCadastralPublicoRouter.post(`${rota}/arquivos`, limiteUpload, carregar, exigeEdicao, vezDoUpload, (request, response, next) => {
  upload.single("arquivo")(request, response, (erro: unknown) => {
    if (erro instanceof multer.MulterError) {
      const message = erro.code === "LIMIT_FILE_SIZE" ? "Arquivo grande demais (máximo 8 MB)." : "Envio inválido.";
      return response.status(erro.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message });
    }
    if (erro) return next(erro);
    next();
  });
}, async (request: ReqFicha, response) => {
  const c = request.ficha!;
  const arquivo = request.file;
  if (!arquivo) return response.status(400).json({ message: "Escolha um arquivo." });
  const tipo = String((request.body as Record<string, unknown>)?.tipo ?? "");
  if (!(tipo in TIPOS_ARQUIVO)) return response.status(400).json({ message: "Escolha que documento é este." });
  const mime = tipoDoConteudo(arquivo.buffer);
  if (!mime) return response.status(415).json({ message: "Envie uma foto (JPG ou PNG) ou um PDF." });
  // Cota conferida com a linha da ficha travada: envios em paralelo não passam juntos do limite,
  // e ficha que saiu das mãos da pessoa no meio do envio não recebe o arquivo.
  const recusa = await prisma.$transaction(async (tx) => {
    const travada = await tx.$queryRaw<Array<{ status: string }>>`SELECT status FROM "FichaCadastral" WHERE id = ${c.ficha.id} FOR UPDATE`;
    if (!EDITAVEL.has(travada[0]?.status ?? "")) return "Esta ficha já foi enviada ao RH e não pode mais ser alterada.";
    const uso = await tx.fichaCadastralArquivo.aggregate({ where: { fichaId: c.ficha.id }, _count: true, _sum: { tamanho: true } });
    if (uso._count >= MAX_ARQUIVOS_POR_FICHA) return `No máximo ${MAX_ARQUIVOS_POR_FICHA} arquivos. Apague algum para enviar outro.`;
    if ((uso._sum.tamanho ?? 0) + arquivo.size > TOTAL_MAXIMO_POR_FICHA) return "Espaço da ficha esgotado. Apague algum arquivo.";
    await tx.fichaCadastralArquivo.create({
      data: {
        fichaId: c.ficha.id, tipo, mimeType: mime, tamanho: arquivo.size, conteudo: arquivo.buffer,
        nomeOriginal: nomeSeguro(arquivo.originalname, mime),
        sha256: crypto.createHash("sha256").update(arquivo.buffer).digest("hex"),
      },
    });
    await tx.fichaCadastral.update({ where: { id: c.ficha.id }, data: { status: "PREENCHENDO" } });
    return null;
  }, { timeout: 20_000 });
  if (recusa) return response.status(409).json({ message: recusa });
  return response.status(201).json(await estado({ ...c, ficha: { ...c.ficha, status: "PREENCHENDO" }, liberada: true }));
});

fichaCadastralPublicoRouter.get(`${rota}/arquivos/:arquivoId`, carregar, exigeEdicao, async (request: ReqFicha, response) => {
  const arquivo = await prisma.fichaCadastralArquivo.findFirst({ where: { id: request.params.arquivoId, fichaId: request.ficha!.ficha.id } });
  if (!arquivo) return response.status(404).json({ message: "Arquivo não encontrado." });
  enviarArquivo(response, arquivo);
});

fichaCadastralPublicoRouter.delete(`${rota}/arquivos/:arquivoId`, carregar, exigeEdicao, async (request: ReqFicha, response) => {
  const c = request.ficha!;
  const apagados = await prisma.fichaCadastralArquivo.deleteMany({ where: { id: request.params.arquivoId, fichaId: c.ficha.id } });
  if (apagados.count === 0) return response.status(404).json({ message: "Arquivo não encontrado." });
  return response.json(await estado(c));
});

fichaCadastralPublicoRouter.post(`${rota}/finalizar`, carregar, exigeEdicao, async (request: ReqFicha, response) => {
  const c = request.ficha!;
  const arquivos = await listaArquivos(c.ficha.id);
  const falta = faltaParaFinalizar(c.dados, arquivos.map((a) => a.tipo), c.ficha.tipo === "ADMISSAO");
  if (falta.length > 0) return response.status(400).json({ message: "Ainda falta preencher algumas informações.", falta });
  // Condição no próprio update: dois toques em "Finalizar" não finalizam duas vezes.
  const r = await prisma.fichaCadastral.updateMany({
    where: { id: c.ficha.id, status: { in: ["ENVIADA", "PREENCHENDO"] } },
    data: { status: "FINALIZADA", finalizadaEm: new Date(), motivoDevolucao: null },
  });
  if (r.count === 1) {
    await auditLog({ action: "FICHA_CADASTRAL_FINALIZADA", entity: "FichaCadastral", entityId: c.ficha.id, ipAddress: ipConfiavel(request), userAgent: String(request.headers["user-agent"] ?? "") });
  }
  return response.json({ status: "FINALIZADA", tipo: c.ficha.tipo, primeiroNome: primeiroNome(c.ficha) });
});


function momentoSp(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
