// Importar a ficha de registro (PDF da contabilidade) pela tela de RH.
//   POST /employees/ficha-registro/previa   (multipart: file, desde?)  → o que cada ficha propõe
//   POST /employees/ficha-registro/aplicar  (multipart: file, selecoes, desde?, motivo?) → grava o marcado
// Prévia e aplicação leem o PDF de novo: o servidor não guarda o arquivo (tem CPF, RG e endereço)
// e recalcula tudo na hora de gravar. Exige ver dados pessoais (mostra salário e documentos).
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { getSessionUser } from "../security/security-utils.js";
import { podeVerDadosPessoais } from "./dados-pessoais.js";
import { hojeEmSaoPaulo } from "./extras-comum.js";
import { lerFichasRegistro } from "./ficha-registro-parser.js";
import { PdfInvalidoError, textoLayoutDoPdf } from "./ficha-registro-texto.js";
import { aplicarImportacao, preverImportacao } from "./ficha-importacao.service.js";

export const fichaImportacaoRouter = Router();

const LIMITE_PDF = 15 * 1024 * 1024;
const MAX_FICHAS = 300;

// A leitura do PDF e a gravação são pesadas e rodam no processo da API: um pedido por vez.
let emAndamento = false;
async function umPorVez(response: Response, trabalho: () => Promise<void>): Promise<void> {
  if (emAndamento) {
    response.status(429).json({ message: "Já há uma importação de ficha em andamento. Tente de novo em instantes." });
    return;
  }
  emAndamento = true;
  try {
    await trabalho();
  } finally {
    emAndamento = false;
  }
}

// Erro interno: o detalhe (que pode trazer CPF ou valores do banco) não vai ao cliente nem ao log.
function falhaInterna(response: Response, e: unknown) {
  console.error("[ficha-registro] falha:", e instanceof Error ? e.name : "desconhecida");
  return response.status(500).json({ message: "Não consegui concluir a importação da ficha. Nada foi gravado para quem deu erro." });
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMITE_PDF, files: 1 } });

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;
const corpoSchema = z.object({
  desde: z.string().optional().transform((v) => (v && v.trim() !== "" ? v.trim() : null)),
  motivo: z.string().optional().transform((v) => (v && v.trim() !== "" ? v.trim().slice(0, 300) : null)),
  selecoes: z.string().optional(),
});
const selecoesSchema = z.record(z.string(), z.array(z.string().max(80)).max(200)).refine((o) => Object.keys(o).length <= MAX_FICHAS);

type Lido = { fichas: Awaited<ReturnType<typeof lerFichasRegistro>>; desde: string | null; motivo: string | null; selecoes: Record<string, string[]> };

// Valida o pedido e lê as fichas. Devolve a resposta de erro pronta quando algo não está certo.
async function lerPedido(request: Request, response: Response): Promise<Lido | null> {
  if (!(await podeVerDadosPessoais(request))) {
    response.status(403).json({ message: "Exige permissão de ver Funcionários." });
    return null;
  }
  const arquivo = request.file;
  if (!arquivo || arquivo.buffer.length === 0) {
    response.status(400).json({ message: "Envie o PDF da ficha de registro." });
    return null;
  }
  if (arquivo.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    response.status(400).json({ message: "O arquivo não é um PDF." });
    return null;
  }
  const corpo = corpoSchema.safeParse(request.body ?? {});
  if (!corpo.success) {
    response.status(400).json({ message: "Pedido inválido." });
    return null;
  }
  const { desde, motivo } = corpo.data;
  if (desde && (!DATA_ISO.test(desde) || isNaN(new Date(`${desde}T00:00:00.000Z`).getTime()))) {
    response.status(400).json({ message: "Data de início dos salários inválida." });
    return null;
  }
  let selecoes: Record<string, string[]> = {};
  if (corpo.data.selecoes) {
    try {
      selecoes = selecoesSchema.parse(JSON.parse(corpo.data.selecoes));
    } catch {
      response.status(400).json({ message: "Seleção inválida." });
      return null;
    }
  }
  try {
    const fichas = lerFichasRegistro(await textoLayoutDoPdf(arquivo.buffer));
    if (fichas.length === 0) {
      response.status(400).json({ message: "Não encontrei nenhuma ficha de registro neste PDF." });
      return null;
    }
    if (fichas.length > MAX_FICHAS) {
      response.status(400).json({ message: `O PDF tem ${fichas.length} fichas (máximo ${MAX_FICHAS}).` });
      return null;
    }
    return { fichas, desde, motivo, selecoes };
  } catch (e) {
    // O leitor de fichas diz o que está fora do formato; erro interno do PDF não vai ao cliente.
    const conhecido = e instanceof PdfInvalidoError || (e instanceof Error && /^(Ficha|Página de continuação)/.test(e.message));
    const mensagem = conhecido ? (e as Error).message.replace(/\.$/, "") : "formato inesperado";
    response.status(400).json({ message: `Não consegui ler a ficha: ${mensagem}.` });
    return null;
  }
}

fichaImportacaoRouter.post("/previa", upload.single("file"), async (request, response) => {
  try {
    await umPorVez(response, async () => {
      const lido = await lerPedido(request, response);
      if (!lido) return;
      const pessoas = await preverImportacao(lido.fichas, lido.desde, hojeEmSaoPaulo());
      response.json({ desde: lido.desde, pessoas });
    });
  } catch (e) {
    return falhaInterna(response, e);
  }
});

fichaImportacaoRouter.post("/aplicar", upload.single("file"), async (request, response) => {
  try {
    await umPorVez(response, async () => {
      const lido = await lerPedido(request, response);
      if (!lido) return;
      const usuario = await getSessionUser(request);
      if (!usuario) {
        response.status(401).json({ message: "Sessão obrigatória." });
        return;
      }
      if (Object.values(lido.selecoes).every((ids) => ids.length === 0)) {
        response.status(400).json({ message: "Marque pelo menos um item para aplicar." });
        return;
      }
      const resultados = await aplicarImportacao(
        lido.fichas, lido.selecoes, lido.desde, hojeEmSaoPaulo(), lido.motivo, { id: usuario.id, nome: usuario.name },
      );
      response.json({ resultados });
    });
  } catch (e) {
    return falhaInterna(response, e);
  }
});

// Arquivo grande demais ou campo extra do multipart: resposta clara em vez de erro 500.
fichaImportacaoRouter.use((error: unknown, _request: Request, response: Response, next: (e?: unknown) => void) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE" ? "PDF grande demais (máximo 15 MB)." : "Envie um único PDF.";
    return response.status(400).json({ message });
  }
  return next(error);
});
