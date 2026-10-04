import type { FichaCadastralResumo, FichaCadastralStatus } from "../../../api/client";
import type { StatusTone } from "../../../design-system";

export const ROTA_FICHAS = "/rh/fichas-cadastrais";
export const rotaFicha = (id: string) => `${ROTA_FICHAS}/${id}`;

export const STATUS_FICHA: Record<FichaCadastralStatus, { rotulo: string; tom: StatusTone }> = {
  ENVIADA: { rotulo: "Link enviado", tom: "neutral" },
  PREENCHENDO: { rotulo: "Preenchendo", tom: "info" },
  FINALIZADA: { rotulo: "Para conferir", tom: "warning" },
  CONCLUIDA: { rotulo: "Concluída", tom: "success" },
  CANCELADA: { rotulo: "Cancelada", tom: "danger" },
};

export function situacao(f: Pick<FichaCadastralResumo, "status" | "vencida">) {
  if (f.vencida) return { rotulo: "Link vencido", tom: "danger" as StatusTone };
  return STATUS_FICHA[f.status];
}

export const linkDaFicha = (codigo: string) => `${window.location.origin}/ficha/${codigo}`;

/** Conversa do WhatsApp com a mensagem pronta; com celular, já abre na pessoa. */
export function linkWhatsapp(nome: string, url: string, tipo: "ADMISSAO" | "ATUALIZACAO", celular?: string | null): string {
  const primeiro = nome.split(" ")[0];
  const texto = tipo === "ADMISSAO"
    ? `Olá, ${primeiro}. Aqui é o Departamento Pessoal do Pateo da Luz.\n\n`
      + `Seja bem-vindo(a) à equipe! Para formalizarmos o seu registro, pedimos que preencha a ficha cadastral e envie as fotos dos documentos pelo link abaixo:\n${url}\n\n`
      + `O preenchimento leva cerca de 10 minutos e o link é válido por 7 dias. Seus dados são tratados com sigilo (LGPD).\n\nObrigado!`
    : `Olá, ${primeiro}. Aqui é o Departamento Pessoal do Pateo da Luz.\n\n`
      + `Estamos atualizando o cadastro da equipe. Pedimos que confira os seus dados e corrija o que tiver mudado pelo link abaixo:\n${url}\n\n`
      + `O link é válido por 7 dias. Seus dados são tratados com sigilo (LGPD).\n\nObrigado!`;
  const numero = (celular ?? "").replace(/\D/g, "");
  const destino = numero.length >= 10 ? (numero.startsWith("55") ? numero : `55${numero}`) : "";
  return `https://wa.me/${destino}?text=${encodeURIComponent(texto)}`;
}

export const dataBr = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
export const diaBr = (iso: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};

export function formatarCpf(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : String(v ?? "");
}
export function formatarCnpj(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : v;
}
export function formatarCep(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : String(v ?? "");
}
export function formatarTelefone(v: unknown): string {
  const d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(v ?? "");
}

/**
 * Valor em reais como o RH digita: "1.500", "1.500,50", "1500,5", "1500.50", "R$ 2.800,00".
 * null = vazio; undefined = não dá para entender (melhor avisar do que gravar R$ 1,50).
 */
export function valorBr(v: unknown): number | null | undefined {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  let t = String(v).replace(/R\$|\s/gi, "");
  if (t === "") return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined;
  return Number(t);
}

/** Número guardado → como aparece no campo ("1.500,00"); texto em digitação fica como está. */
export function valorNoCampo(v: unknown): string {
  if (v == null) return "";
  return typeof v === "number" ? v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v);
}

/** Parte da empresa pronta para enviar; erro com a mensagem para o RH se um valor não fizer sentido. */
export function empresaParaEnvio<T extends { salario?: unknown; valorVt?: unknown }>(empresa: T): T {
  const salario = valorBr(empresa.salario);
  if (salario === undefined) throw new Error("Salário: use o formato 1.500,00.");
  const valorVt = valorBr(empresa.valorVt);
  if (valorVt === undefined) throw new Error("Valor do VT: use o formato 250,00.");
  return { ...empresa, salario, valorVt };
}

/** Copia para a área de transferência e diz se conseguiu (sem permissão, o RH copia à mão). */
export async function copiarTexto(texto: string, campoId?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const campo = campoId ? (document.getElementById(campoId) as HTMLInputElement | null) : null;
    if (!campo) return false;
    campo.select();
    try { return document.execCommand?.("copy") ?? false; } catch { return false; }
  }
}

/** Prazo de guarda (LGPD): cancelada ou vencida é apagada 90 dias depois (rotina do servidor). */
export const DIAS_GUARDA = 90;

/** Quando a ficha será apagada; null = não será (aberta no prazo, enviada ao RH ou concluída). */
export function apagaEm(f: { status: string; expiraEm: string; canceladaEm: string | null }, agora = Date.now()): Date | null {
  const mais = (iso: string) => new Date(new Date(iso).getTime() + DIAS_GUARDA * 86_400_000);
  if (f.status === "CANCELADA" && f.canceladaEm) return mais(f.canceladaEm);
  if ((f.status === "ENVIADA" || f.status === "PREENCHENDO") && new Date(f.expiraEm).getTime() < agora) return mais(f.expiraEm);
  return null;
}
