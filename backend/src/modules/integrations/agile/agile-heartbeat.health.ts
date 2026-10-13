// Regras de saúde do agente do PDV. Função pura: recebe o registro e "agora"
// (hora do SERVIDOR) e devolve o que a tela deve mostrar. Nada é gravado aqui,
// então o estado "PDV sem sincronizar" aparece mesmo com a máquina desligada,
// sem depender de tarefa agendada (o backend no plano free dorme).

const HORA_MS = 60 * 60 * 1000;
export const LIMITE_ALERTA_HORAS = 26;
export const LIMITE_CRITICO_HORAS = 48;

export type NivelAlerta = "info" | "alerta" | "critico";
export type EstadoAgente = "aguardando" | "ok" | "erro" | "atrasado" | "critico";

export type AlertaAgente = { nivel: NivelAlerta; mensagem: string };

export type RegistroHeartbeat = {
  ultimoStatus: string;
  ultimaMensagem: string | null;
  ultimoHeartbeatEm: Date;
  ultimoOkEm: Date | null;
  ultimoOkPeriodoFim: string | null;
};

export type SaudeAgente = {
  estado: EstadoAgente;
  alertas: AlertaAgente[];
  horasSemOk: number | null;
  ultimoStatus: string | null;
  ultimoHeartbeatEm: string | null;
  ultimoOkEm: string | null;
  ultimoOkPeriodoFim: string | null;
};

const PESO_NIVEL: Record<NivelAlerta, number> = { critico: 0, alerta: 1, info: 2 };

// Data legível no fuso do restaurante. Fixo em São Paulo para não depender do TZ
// do processo (o servidor roda em UTC).
function formatarDataHora(data: Date): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(data);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}`;
}

export function avaliarSaudeAgente(registro: RegistroHeartbeat | null, agora: Date): SaudeAgente {
  if (!registro) {
    return {
      estado: "aguardando",
      alertas: [{ nivel: "info", mensagem: "Aguardando primeiro heartbeat do PDV" }],
      horasSemOk: null,
      ultimoStatus: null,
      ultimoHeartbeatEm: null,
      ultimoOkEm: null,
      ultimoOkPeriodoFim: null
    };
  }

  const alertas: AlertaAgente[] = [];
  let estado: EstadoAgente = "ok";

  const msSemOk = registro.ultimoOkEm ? agora.getTime() - registro.ultimoOkEm.getTime() : null;
  const horasSemOk = msSemOk === null ? null : Math.max(0, Math.floor(msSemOk / HORA_MS));

  if (registro.ultimoStatus === "erro") {
    const detalhe = registro.ultimaMensagem?.trim() || "sem detalhe informado pelo agente";
    alertas.push({ nivel: "alerta", mensagem: `Último sync do PDV falhou: ${detalhe}` });
    estado = "erro";
  }

  // Limites estritos (">"): exatamente 26 h / 48 h ainda é o ciclo normal.
  if (msSemOk !== null && registro.ultimoOkEm && msSemOk > LIMITE_ALERTA_HORAS * HORA_MS) {
    const critico = msSemOk > LIMITE_CRITICO_HORAS * HORA_MS;
    alertas.push({
      nivel: critico ? "critico" : "alerta",
      mensagem: `PDV sem sincronizar há ${horasSemOk} h (último OK em ${formatarDataHora(registro.ultimoOkEm)})`
    });
    estado = critico ? "critico" : estado === "erro" ? "erro" : "atrasado";
  }

  alertas.sort((a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel]);

  return {
    estado,
    alertas,
    horasSemOk,
    ultimoStatus: registro.ultimoStatus,
    ultimoHeartbeatEm: registro.ultimoHeartbeatEm.toISOString(),
    ultimoOkEm: registro.ultimoOkEm ? registro.ultimoOkEm.toISOString() : null,
    ultimoOkPeriodoFim: registro.ultimoOkPeriodoFim
  };
}
