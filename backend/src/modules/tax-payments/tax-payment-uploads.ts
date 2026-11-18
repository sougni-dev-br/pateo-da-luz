import fs from "node:fs";
import path from "node:path";

// A prévia da importação grava a planilha em disco e a confirmação a lê e apaga. Quem sobe a prévia e não confirma (ou a
// confirmação que cai no meio) deixa o arquivo para trás. A pasta é só desta importação, então pode ser varrida sem
// risco de apagar anexo de outro módulo (a pasta "uploads/" comum é dividida com outras importações).
export const PASTA_UPLOADS_IMPOSTOS = "uploads/impostos/";

const DUAS_HORAS_MS = 2 * 60 * 60 * 1000;
// O arquivo reservado (".processando") guarda a data de modificação da prévia: uma importação confirmada aos 1h59 não pode
// ter a reserva apagada no meio. Só vira lixo depois de bem mais tempo.
const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;

// Apaga os arquivos da pasta mais antigos que `idadeMaximaMs` (pela data de modificação) e os ".processando" que ficaram
// presos há mais de 6 horas. Devolve quantos apagou. Nunca lança: se outro pedido apagou ou está usando o arquivo, segue.
export async function limparUploadsAntigos(
  pasta: string = PASTA_UPLOADS_IMPOSTOS,
  idadeMaximaMs: number = DUAS_HORAS_MS,
  agora: number = Date.now(),
): Promise<number> {
  let nomes: string[];
  try {
    nomes = await fs.promises.readdir(pasta);
  } catch {
    return 0; // a pasta ainda não existe
  }
  let apagados = 0;
  for (const nome of nomes) {
    const caminho = path.join(pasta, nome);
    try {
      const info = await fs.promises.stat(caminho);
      const limite = nome.endsWith(".processando") ? Math.max(idadeMaximaMs, SEIS_HORAS_MS) : idadeMaximaMs;
      if (!info.isFile() || agora - info.mtimeMs < limite) continue;
      await fs.promises.unlink(caminho);
      apagados += 1;
    } catch {
      /* sumiu ou está em uso: fica para a próxima varredura */
    }
  }
  return apagados;
}
