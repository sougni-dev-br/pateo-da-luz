import { Router, type NextFunction, type Request, type Response } from "express";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { prisma } from "../../config/database.js";
import { auditLog, getSessionUser, requestIp } from "../security/security-utils.js";
import { userHasPermission } from "../security/menu-permissions.js";
import { FOTO_ESPACO_MAXIMO, FOTO_TAMANHO_MAXIMO, validarFoto } from "./waste-photo.js";
import { expurgarFotosDeDesperdicio } from "./waste-photo-expurgo.js";
import { LIMITE_DE_FOTOS, limitarGravacoes } from "./waste-limite.js";

// Foto do desperdício. Montado dentro do módulo /waste, então herda o portão de permissão dele:
// enviar é "criar", ver é "ver", apagar é "excluir".
export const wastePhotoRouter = Router();

// Só um arquivo e nada além dele: sem campos de texto soltos (cada um poderia ter até 1 MB e a conta é em memória).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: FOTO_TAMANHO_MAXIMO + 1, files: 1, fields: 0, parts: 2 } });
// Corpo declarado muito maior que a foto nem chega ao multer.
const CORPO_MAXIMO = FOTO_TAMANHO_MAXIMO + 16 * 1024;

const auditMeta = (request: Request) => ({ ipAddress: requestIp(request), userAgent: String(request.headers["user-agent"] ?? "") });
const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Arquivo grande demais chega como erro do multer: vira a mesma mensagem de tamanho, não um 500. */
async function receberFoto(request: Request, response: Response, next: NextFunction) {
  // Sessão antes de ler o corpo: o multer só trabalha para quem está logado.
  if (!(await getSessionUser(request))) return void response.status(401).json({ message: "Sessao obrigatoria." });
  if (Number(request.headers["content-length"] ?? 0) > CORPO_MAXIMO) {
    return void response.status(413).json({ message: `A foto passou de ${Math.round(FOTO_TAMANHO_MAXIMO / 1024)} KB. Tire outra ou reduza a imagem.` });
  }
  upload.single("photo")(request, response, (erro: unknown) => {
    if (!erro) return next();
    if (erro instanceof multer.MulterError && erro.code === "LIMIT_FILE_SIZE") {
      return void response.status(413).json({ message: `A foto passou de ${Math.round(FOTO_TAMANHO_MAXIMO / 1024)} KB. Tire outra ou reduza a imagem.` });
    }
    console.warn("[desperdicio-fotos] upload recusado pelo multer:", erro instanceof Error ? erro.message : erro);
    return void response.status(400).json({ message: "Não foi possível ler a foto enviada." });
  });
}

wastePhotoRouter.post("/:id/photo", limitarGravacoes(LIMITE_DE_FOTOS), receberFoto, async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });
  if (!request.file) return void response.status(400).json({ message: "Envie a foto no campo 'photo'." });

  const foto = validarFoto(request.file.buffer);
  if (!foto.ok) return void response.status(400).json({ message: foto.erro });

  const entrada = await prisma.wasteEntry.findUnique({ where: { id: request.params.id }, select: { id: true, registeredById: true, cancelledAt: true, photo: { select: { id: true } } } });
  if (!entrada) return void response.status(404).json({ message: "Lançamento não encontrado." });
  if (entrada.cancelledAt) return void response.status(409).json({ message: "Este lançamento foi cancelado." });
  // Anexar prova a lançamento de outra pessoa é decisão de gestão (a mesma força de cancelar).
  if (entrada.registeredById !== user.id && !(await userHasPermission(user as never, "inventory-waste", "delete"))) {
    return void response.status(403).json({ message: "Só quem lançou, ou a gestão, pode anexar a foto." });
  }
  if (entrada.photo) return void response.status(409).json({ message: "Este lançamento já tem foto. Apague a atual para trocar." });

  // As fotos moram no banco: um teto para a soma impede que uso indevido (ou um laço no cliente) o encha.
  // Perto do teto, tenta liberar as que já passaram do prazo antes de recusar: o expurgo diário pode não
  // ter rodado (a instância reinicia), e recusar com fotos vencidas ocupando o espaço seria injusto.
  const somaDeFotos = async () => (await prisma.wasteEntryPhoto.aggregate({ _sum: { size: true } }))._sum.size ?? 0;
  let uso = await somaDeFotos();
  if (uso + foto.tamanho > FOTO_ESPACO_MAXIMO) {
    await expurgarFotosDeDesperdicio().catch((falha) => console.error("[desperdicio-fotos] expurgo sob demanda falhou:", falha instanceof Error ? falha.message : falha));
    uso = await somaDeFotos();
  }
  if (uso + foto.tamanho > FOTO_ESPACO_MAXIMO) {
    return void response.status(507).json({ message: "O espaço reservado para fotos de desperdício acabou. Avise a gestão: ela pode apagar fotos de lançamentos antigos (as com mais de 90 dias saem sozinhas)." });
  }

  try {
    await prisma.wasteEntryPhoto.create({ data: { entryId: entrada.id, mimeType: foto.mimeType, size: foto.tamanho, sha256: foto.sha256, content: request.file.buffer } });
  } catch (falha) {
    if (isUniqueViolation(falha)) return void response.status(409).json({ message: "Este lançamento já tem foto. Apague a atual para trocar." });
    throw falha;
  }
  await auditLog({ userId: user.id, action: "ADD_WASTE_PHOTO", entity: "WasteEntry", entityId: entrada.id, newValue: { size: foto.tamanho, sha256: foto.sha256 }, ...auditMeta(request) });
  response.status(201).json({ ok: true, size: foto.tamanho });
});

wastePhotoRouter.get("/:id/photo", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const foto = await prisma.wasteEntryPhoto.findUnique({ where: { entryId: request.params.id }, select: { mimeType: true, content: true, sha256: true } });
  if (!foto) return void response.status(404).json({ message: "Este lançamento não tem foto." });

  response.setHeader("Content-Type", foto.mimeType);
  response.setHeader("Content-Disposition", "inline");
  // O conteúdo nunca é interpretado pelo navegador como outra coisa, e a foto não fica em cache compartilhado.
  response.setHeader("X-Content-Type-Options", "nosniff");
  // Mesma defesa em profundidade das fotos da ficha cadastral: nada executa a partir deste arquivo.
  response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  // Revalida sempre (o ETag evita reenviar): foto apagada não pode continuar saindo do cache.
  response.setHeader("Cache-Control", "private, no-cache");
  response.setHeader("Vary", "Authorization");
  response.setHeader("ETag", `"${foto.sha256}"`);
  response.send(Buffer.from(foto.content));
});

wastePhotoRouter.delete("/:id/photo", async (request, response) => {
  const user = await getSessionUser(request);
  if (!user) return void response.status(401).json({ message: "Sessao obrigatoria." });

  const { count } = await prisma.wasteEntryPhoto.deleteMany({ where: { entryId: request.params.id } });
  if (count === 0) return void response.status(404).json({ message: "Este lançamento não tem foto." });
  await auditLog({ userId: user.id, action: "DELETE_WASTE_PHOTO", entity: "WasteEntry", entityId: request.params.id, ...auditMeta(request) });
  response.json({ ok: true });
});
