// Trava de produção dos scripts que gravam no banco (backfill, importações, limpezas).
//
// Antes cada script só exigia --producao quando o host terminava em "render.com". Tudo o
// que não casava passava direto: o host interno do Render ("dpg-...-a", sem domínio), um
// DATABASE_URL vazio ou inválido ("?"), um IP. A lógica agora é a inversa: gravar sem
// --producao só vale para banco local, conhecido pelo nome. Qualquer outro destino exige
// a confirmação explícita.

export const HOSTS_LOCAIS: ReadonlySet<string> = new Set([
  "localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal",
]);

// Host do DATABASE_URL em minúsculas; "?" quando vazio ou inválido.
export function hostDoBanco(url: string | undefined | null): string {
  try {
    return new URL(url ?? "").hostname.toLowerCase() || "?";
  } catch {
    return "?";
  }
}

export function ehHostLocal(host: string): boolean {
  return HOSTS_LOCAIS.has(host.toLowerCase());
}

export type DestinoBanco = { host: string; aplicar: boolean; producao: boolean };

// Lê --aplicar/--producao dos argumentos e confere o destino. Lança (sem gravar nada)
// quando vai gravar num host que não é local e --producao não veio.
export function conferirDestino(args: readonly string[], url: string | undefined | null): DestinoBanco {
  const host = hostDoBanco(url);
  const aplicar = args.includes("--aplicar");
  const producao = args.includes("--producao");
  if (aplicar && !producao && !ehHostLocal(host)) {
    throw new Error(
      `O destino (${host}) não é um banco local: para gravar nele, confirme com --producao junto de --aplicar.`,
    );
  }
  return { host, aplicar, producao };
}
