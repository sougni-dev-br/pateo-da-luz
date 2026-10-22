// Apresentação da lista "Ciclos de pagamento" da tela Delivery.
//
// A lista só reconhecia o status `PAID` e chamava todo o resto de "Pendente". Os
// repasses do iFood importados do portal vêm com a situação real (PAGO, EM_ABERTO,
// SALDO_PENDENTE, SUSPENSO) e apareciam todos como "Pendente", inclusive os já pagos.

const ROTULOS: Record<string, string> = {
  PAID: "Pago",
  PAGO: "Pago",
  PENDING: "Pendente",
  PENDENTE: "Pendente",
  EM_ABERTO: "Em aberto",
  SALDO_PENDENTE: "Saldo pendente",
  SUSPENSO: "Suspenso"
};

/** Status desconhecido mostra o texto cru (legível), nunca vira "Pendente" por engano. */
export function rotuloStatusRepasse(status: string): string {
  const chave = status.trim().toUpperCase();
  const rotulo = ROTULOS[chave];
  if (rotulo) return rotulo;
  const texto = status.trim().replace(/_/g, " ").toLowerCase();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : "—";
}

/** Tom do selo de status: só o "Pago" é neutro/positivo; suspenso e saldo pendente chamam atenção. */
export type TomRepasse = "ok" | "atencao" | "neutro";

export function tomDoStatusRepasse(status: string): TomRepasse {
  switch (rotuloStatusRepasse(status)) {
    case "Pago":
      return "ok";
    case "Suspenso":
    case "Saldo pendente":
      return "atencao";
    default:
      return "neutro";
  }
}

export type LinhaOrdenavel = { periodStart: string; storeLabel?: string; platform: string };

/** Período mais antigo primeiro; no mesmo período, plataforma e loja em ordem alfabética (estável). */
export function ordenarRepasses<T extends LinhaOrdenavel>(linhas: T[]): T[] {
  return [...linhas].sort((a, b) => {
    if (a.periodStart !== b.periodStart) return a.periodStart < b.periodStart ? -1 : 1;
    if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1;
    return (a.storeLabel ?? "").localeCompare(b.storeLabel ?? "", "pt-BR");
  });
}

const dataBR = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/** "2026-10-01" + "2026-10-04" -> "01/10/2026 → 04/10/2026" (sem fuso: só reordena o texto). */
export function formatarPeriodoRepasse(inicio: string, fim: string): string {
  return `${dataBR(inicio)} → ${dataBR(fim)}`;
}
