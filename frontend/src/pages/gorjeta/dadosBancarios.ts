// Dados bancários de uma linha da folha de líquidos, iguais na tela e no PDF:
// o PIX (com o tipo da chave) e a conta do cadastro, cada um na sua linha.
import type { TipLinhaFolha } from "../../api/client";

const TIPO_PIX: Record<string, string> = { CPF: "CPF", EMAIL: "e-mail", TELEFONE: "telefone", ALEATORIA: "aleatória" };

export const SEM_DADOS_BANCARIOS = "Sem dados bancários no cadastro";

export function linhasDadosBancarios(l: Pick<TipLinhaFolha, "pix" | "pixTipo" | "contaBancaria">): string[] {
  const pix = l.pix?.trim();
  const tipo = l.pixTipo ? TIPO_PIX[l.pixTipo] ?? l.pixTipo.toLowerCase() : null;
  return [
    ...(pix ? [`PIX${tipo ? ` (${tipo})` : ""}: ${pix}`] : []),
    ...(l.contaBancaria?.trim() ? [l.contaBancaria.trim()] : []),
  ];
}
