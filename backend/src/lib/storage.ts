import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "pateo-attachments";

// True quando todas as 3 variáveis estão definidas no ambiente
export const r2Enabled =
  !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

let _r2Client: S3Client | null = null;

function r2Client(): S3Client {
  if (!r2Enabled) throw new Error("R2 não configurado — defina R2_ACCOUNT_ID, R2_ACCESS_KEY_ID e R2_SECRET_ACCESS_KEY.");
  if (!_r2Client) {
    _r2Client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID!,
        secretAccessKey: R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return _r2Client;
}

/**
 * Envia um buffer para o bucket R2.
 * @param key  Caminho relativo dentro do bucket (ex: "tax-payments/<id>/<filename>")
 */
export async function uploadToR2(
  key: string,
  buffer: Buffer,
  mimeType: string
): Promise<void> {
  await r2Client().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );
}

/**
 * Gera uma URL pré-assinada para download do objeto.
 * Expira em `expiresIn` segundos (padrão: 1 hora).
 */
export async function getR2SignedUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(r2Client(), command, { expiresIn });
}

/**
 * Remove um objeto do bucket R2.
 */
export async function deleteFromR2(key: string): Promise<void> {
  await r2Client().send(
    new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );
}
