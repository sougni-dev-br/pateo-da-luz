// Chamadas do link público da ficha cadastral. Sem sessão do sistema: quem abre é a pessoa
// sendo admitida. A chave de acesso (depois de confirmar a data de nascimento) fica no
// sessionStorage da aba, por ficha — recarregar a página não pede a data de novo.
import { API_BASE_URL } from "../../api/client";

/** `ref`: dependente que já está no cadastro (atualização). Volta como veio. */
export type Filho = { nome: string; dataNascimento: string | null; cpf: string | null; ref?: string | null };
export type Dados = Record<string, string | boolean | Filho[] | null | undefined> & { filhos?: Filho[] };
export type Arquivo = { id: string; tipo: string; nomeOriginal: string; mimeType: string; tamanho: number; createdAt: string };
export type Opcoes = {
  estadosCivis: string[]; racasCores: string[]; escolaridades: string[]; ufs: string[];
  tiposArquivo: Record<string, string>; arquivosObrigatorios: string[];
};
export type Status = "ENVIADA" | "PREENCHENDO" | "FINALIZADA" | "CONCLUIDA" | "CANCELADA";
export type Estado = {
  status: Status; tipo: "ADMISSAO" | "ATUALIZACAO"; primeiroNome?: string;
  verificacao?: "NASCIMENTO" | "CPF" | null;
  expiraEm?: string; motivoDevolucao?: string | null; dados?: Dados; arquivos?: Arquivo[]; falta?: string[]; opcoes?: Opcoes; acesso?: string;
};

export class ErroFicha extends Error {
  constructor(message: string, public readonly status: number, public readonly corpo: Record<string, unknown> | null) { super(message); }
}

const chaveSessao = (codigo: string) => `ficha-acesso:${codigo.slice(0, 12)}`;

function lerAcesso(codigo: string): string | null {
  try { return sessionStorage.getItem(chaveSessao(codigo)); } catch { return null; }
}

function guardarAcesso(codigo: string, acesso: string | undefined) {
  if (!acesso) return;
  try { sessionStorage.setItem(chaveSessao(codigo), acesso); } catch { /* aba anônima sem armazenamento: pede a data de novo */ }
}

async function chamar<T>(codigo: string, caminho: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const acesso = lerAcesso(codigo);
  if (acesso) headers.set("X-Ficha-Acesso", acesso);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let resposta: Response;
  try {
    resposta = await fetch(`${API_BASE_URL}/public/ficha-cadastral/${encodeURIComponent(codigo)}${caminho}`, { ...init, headers });
  } catch {
    throw new ErroFicha("Sem conexão com a internet. Confira o sinal e tente de novo.", 0, null);
  }
  const corpo = await resposta.json().catch(() => null) as Record<string, unknown> | null;
  if (!resposta.ok) throw new ErroFicha(String(corpo?.message ?? "Algo deu errado. Tente de novo."), resposta.status, corpo);
  const estado = corpo as T & { acesso?: string };
  guardarAcesso(codigo, estado?.acesso);
  return estado;
}

export const abrirFicha = (codigo: string) => chamar<Estado>(codigo, "");
export const verificar = (codigo: string, resposta: string) =>
  chamar<Estado>(codigo, "/verificar", { method: "POST", body: JSON.stringify({ resposta }) });
export const salvarDados = (codigo: string, dados: Dados) =>
  chamar<Estado>(codigo, "/dados", { method: "PUT", body: JSON.stringify(dados) });
export const finalizar = (codigo: string) => chamar<Estado>(codigo, "/finalizar", { method: "POST" });
export const apagarArquivo = (codigo: string, id: string) => chamar<Estado>(codigo, `/arquivos/${id}`, { method: "DELETE" });

const PRAZO_ENVIO_MS = 90_000;

/** Envio de foto com prazo: em 4G fraco o botão não fica "Enviando…" para sempre. */
export async function enviarArquivo(codigo: string, tipo: string, arquivo: Blob, nome: string) {
  const form = new FormData();
  form.append("tipo", tipo);
  form.append("arquivo", arquivo, nome);
  const controle = new AbortController();
  const prazo = window.setTimeout(() => controle.abort(), PRAZO_ENVIO_MS);
  try {
    return await chamar<Estado>(codigo, "/arquivos", { method: "POST", body: form, signal: controle.signal });
  } catch (e) {
    if (controle.signal.aborted) throw new ErroFicha("A conexão está lenta e o envio não terminou. Tente de novo no Wi-Fi ou com sinal melhor.", 0, null);
    throw e;
  } finally {
    window.clearTimeout(prazo);
  }
}

/** Miniatura do arquivo já enviado (com a chave de acesso no cabeçalho, por isso não é <img src>). */
export async function baixarArquivo(codigo: string, id: string): Promise<Blob> {
  const acesso = lerAcesso(codigo);
  const resposta = await fetch(`${API_BASE_URL}/public/ficha-cadastral/${encodeURIComponent(codigo)}/arquivos/${id}`, {
    headers: acesso ? { "X-Ficha-Acesso": acesso } : {},
  });
  if (!resposta.ok) throw new ErroFicha("Não foi possível abrir o arquivo.", resposta.status, null);
  return resposta.blob();
}
