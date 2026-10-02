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
    ? `Olá, ${primeiro}! Para o seu registro no Pateo da Luz, preencha a ficha cadastral e envie as fotos dos documentos por este link (vale por 7 dias):\n${url}`
    : `Olá, ${primeiro}! Precisamos atualizar seus dados no Pateo da Luz. Confira e corrija o que mudou por este link (vale por 7 dias):\n${url}`;
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
