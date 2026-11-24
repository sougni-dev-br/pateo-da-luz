import { ApiError } from "../../api/client";

// Mensagens de erro em linguagem de gente. O client devolve "Erro HTTP 500" quando o servidor não manda texto;
// aqui isso vira uma frase que diz o que houve e termina com pontuação, para poder ser emendada com a próxima.

const SO_O_CODIGO = /^Erro HTTP (\d{3})$/;

function porStatus(status: number): string | null {
  if (status === 0) return "Sem conexão com o servidor.";
  if (status === 401) return "A sessão expirou. Entre de novo para continuar.";
  if (status === 403) return "Seu usuário não tem permissão para isso.";
  if (status === 404) return "O cenário não existe mais (pode ter sido excluído).";
  if (status === 429) return "Muitas tentativas seguidas. Espere alguns segundos.";
  if (status >= 500) return `O servidor não respondeu (erro ${status}).`;
  return null;
}

/** Garante ponto final, para a frase seguinte não grudar ("…erro 500 Suas alterações…"). */
export function comPonto(texto: string): string {
  const limpo = texto.trim();
  if (limpo === "") return limpo;
  return /[.!?…:]$/.test(limpo) ? limpo : `${limpo}.`;
}

export function mensagemHumana(erro: unknown, padrao: string): string {
  if (erro instanceof ApiError) {
    const soCodigo = SO_O_CODIGO.test(erro.message.trim());
    if (soCodigo || !erro.message.trim()) return porStatus(erro.status) ?? comPonto(padrao);
    return comPonto(erro.message);
  }
  if (erro instanceof Error && erro.message.trim()) {
    const codigo = SO_O_CODIGO.exec(erro.message.trim());
    if (codigo) return porStatus(Number(codigo[1])) ?? comPonto(padrao);
    // fetch sem rede: "Failed to fetch" / "NetworkError…"
    if (/failed to fetch|networkerror|load failed/i.test(erro.message)) return "Sem conexão com o servidor.";
    return comPonto(erro.message);
  }
  return comPonto(padrao);
}
