// Discriminação da guia: a "Composição do Documento de Arrecadação" do DAS/DARF e os campos do FGTS Digital.
// O valor da guia é a soma das linhas (principal + multa + juros), calculada em centavos para não acumular erro de ponto flutuante.

export type ItemGuia = {
  code: string | null;
  description: string;
  principal: number;
  fine: number;
  interest: number;
};

export type ItensNormalizados = { ok: true; itens: ItemGuia[]; total: number } | { ok: false; message: string };

export const MAXIMO_DE_LINHAS = 40;
const MAXIMO_DE_VALOR = 9_999_999_999.99;

const emCentavos = (n: number) => Math.round(n * 100);

// Só número ou texto no formato canônico ("1234.56"). "1.234" (milhar brasileiro), "0x10", true ou [5] são recusados:
// Number() os aceitaria e o valor sairia errado em silêncio.
const VALOR_CANONICO = /^\d+(\.\d{1,2})?$/;

function lerValor(valor: unknown): number | null {
  if (valor == null || valor === "") return 0;
  let n: number;
  if (typeof valor === "number") n = valor;
  else if (typeof valor === "string" && VALOR_CANONICO.test(valor.trim())) n = Number(valor.trim());
  else return null;
  if (!Number.isFinite(n) || n < 0 || n > MAXIMO_DE_VALOR) return null;
  return emCentavos(n) / 100;
}

export function totalDaLinha(item: Pick<ItemGuia, "principal" | "fine" | "interest">): number {
  return (emCentavos(item.principal) + emCentavos(item.fine) + emCentavos(item.interest)) / 100;
}

export function normalizarItens(bruto: unknown): ItensNormalizados {
  if (!Array.isArray(bruto) || bruto.length === 0) {
    return { ok: false, message: "Informe ao menos uma linha na discriminação da guia." };
  }
  if (bruto.length > MAXIMO_DE_LINHAS) {
    return { ok: false, message: `A discriminação aceita até ${MAXIMO_DE_LINHAS} linhas.` };
  }

  const itens: ItemGuia[] = [];
  for (let i = 0; i < bruto.length; i += 1) {
    const linha = bruto[i] as Record<string, unknown> | null;
    const n = i + 1;
    if (linha == null || typeof linha !== "object") return { ok: false, message: `Linha ${n}: formato inválido.` };

    const description = typeof linha.description === "string" ? linha.description.trim() : "";
    if (!description) return { ok: false, message: `Linha ${n}: informe a denominação.` };
    if (description.length > 200) return { ok: false, message: `Linha ${n}: denominação com mais de 200 caracteres.` };

    if (linha.code != null && typeof linha.code !== "string" && typeof linha.code !== "number") {
      return { ok: false, message: `Linha ${n}: código inválido.` };
    }
    const codigo = linha.code == null ? "" : String(linha.code).trim();
    if (codigo.length > 20) return { ok: false, message: `Linha ${n}: código com mais de 20 caracteres.` };

    const principal = lerValor(linha.principal);
    const fine = lerValor(linha.fine);
    const interest = lerValor(linha.interest);
    if (principal == null || fine == null || interest == null) return { ok: false, message: `Linha ${n}: valor inválido.` };

    const item: ItemGuia = { code: codigo || null, description, principal, fine, interest };
    if (totalDaLinha(item) <= 0) return { ok: false, message: `Linha ${n}: informe o valor (principal, multa ou juros).` };
    itens.push(item);
  }

  const total = itens.reduce((s, i) => s + emCentavos(totalDaLinha(i)), 0) / 100;
  // O valor da guia é Decimal(12,2): somar 40 linhas no limite de cada campo estouraria o banco com erro 500.
  if (total > MAXIMO_DE_VALOR) return { ok: false, message: "A soma das linhas passa do valor máximo de uma guia." };
  return { ok: true, itens, total };
}

// Texto curto com as denominações: aparece na lista e ajuda a categorizar (o DARF se separa em INSS e IRRF pela descrição).
export function descricaoDosItens(itens: ReadonlyArray<Pick<ItemGuia, "description">>): string {
  const texto = itens.map((i) => i.description).join(" · ");
  return texto.length > 240 ? `${texto.slice(0, 237)}...` : texto;
}

export type NumeroDoDocumento = { ok: true; valor: string | null } | { ok: false };

// Número do documento do DAS/DARF ("07.20.26290.7165263-2") ou identificador do FGTS: texto livre curto.
export function lerNumeroDoDocumento(bruto: unknown): NumeroDoDocumento {
  if (bruto == null) return { ok: true, valor: null };
  if (typeof bruto !== "string" && typeof bruto !== "number") return { ok: false };
  const texto = String(bruto).trim();
  if (texto.length > 60) return { ok: false };
  return { ok: true, valor: texto || null };
}
