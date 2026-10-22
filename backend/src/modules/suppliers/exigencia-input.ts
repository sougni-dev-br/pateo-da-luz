// Leitura e validação do corpo das exigências de fechamento do fornecedor.
// Pura, para poder testar sem subir a rota.

const TAMANHO_MAXIMO_DO_NOME = 80;

export type ExigenciaLida = { label: string; productId: string };

export type ResultadoDaLeitura<T> = { ok: true; valor: T } | { ok: false; erro: string };

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function lerNome(bruto: unknown): ResultadoDaLeitura<string> {
  const nome = texto(bruto);
  if (!nome) return { ok: false, erro: "Informe o nome do lançamento (ex.: Parcelamento de dívida)." };
  if (nome.length > TAMANHO_MAXIMO_DO_NOME) {
    return { ok: false, erro: `O nome pode ter no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.` };
  }
  return { ok: true, valor: nome };
}

export function lerExigencia(corpo: unknown, opcoes: { parcial: true }): ResultadoDaLeitura<Partial<ExigenciaLida>>;
export function lerExigencia(corpo: unknown, opcoes?: { parcial?: false }): ResultadoDaLeitura<ExigenciaLida>;
export function lerExigencia(corpo: unknown, opcoes: { parcial?: boolean } = {}): ResultadoDaLeitura<Partial<ExigenciaLida>> {
  const dados = corpo !== null && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  const temNome = "label" in dados;
  const temProduto = "productId" in dados;

  if (opcoes.parcial && !temNome && !temProduto) {
    return { ok: false, erro: "Nada para alterar: informe o nome ou o produto." };
  }

  const valor: Partial<ExigenciaLida> = {};
  if (!opcoes.parcial || temNome) {
    const nome = lerNome(dados.label);
    if (!nome.ok) return nome;
    valor.label = nome.valor;
  }
  if (!opcoes.parcial || temProduto) {
    const produto = texto(dados.productId);
    if (!produto) return { ok: false, erro: "Escolha o produto que identifica este lançamento nas compras." };
    valor.productId = produto;
  }
  return { ok: true, valor };
}
