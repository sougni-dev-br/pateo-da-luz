import { describe, expect, test } from "vitest";
import { avaliarSaudeAgente, type RegistroHeartbeat } from "../agile-heartbeat.health.js";

const HORA = 60 * 60 * 1000;
const agora = new Date("2026-10-13T15:00:00.000Z");

function registro(over: Partial<RegistroHeartbeat> = {}): RegistroHeartbeat {
  return {
    ultimoStatus: "ok",
    ultimaMensagem: null,
    ultimoHeartbeatEm: new Date(agora.getTime() - 1 * HORA),
    ultimoOkEm: new Date(agora.getTime() - 1 * HORA),
    ultimoOkPeriodoFim: "2026-10-13",
    ...over
  };
}

describe("avaliarSaudeAgente", () => {
  test("sem nenhum heartbeat, avisa apenas que aguarda o primeiro (informativo)", () => {
    const s = avaliarSaudeAgente(null, agora);
    expect(s.estado).toBe("aguardando");
    expect(s.alertas).toEqual([{ nivel: "info", mensagem: "Aguardando primeiro heartbeat do PDV" }]);
  });

  test("ok recente nao gera alerta", () => {
    const s = avaliarSaudeAgente(registro(), agora);
    expect(s.estado).toBe("ok");
    expect(s.alertas).toEqual([]);
    expect(s.horasSemOk).toBe(1);
  });

  test("ultimo status erro vira alerta com a mensagem do agente", () => {
    const s = avaliarSaudeAgente(registro({ ultimoStatus: "erro", ultimaMensagem: "login recusado" }), agora);
    expect(s.estado).toBe("erro");
    expect(s.alertas).toContainEqual({ nivel: "alerta", mensagem: "Último sync do PDV falhou: login recusado" });
  });

  test("erro sem mensagem nao imprime 'null'", () => {
    const s = avaliarSaudeAgente(registro({ ultimoStatus: "erro", ultimaMensagem: null }), agora);
    expect(s.alertas[0].mensagem).toBe("Último sync do PDV falhou: sem detalhe informado pelo agente");
  });

  test("exatamente 26 h ainda nao alerta; passou de 26 h alerta", () => {
    const limite = registro({ ultimoOkEm: new Date(agora.getTime() - 26 * HORA) });
    expect(avaliarSaudeAgente(limite, agora).alertas).toEqual([]);

    const passou = registro({ ultimoOkEm: new Date(agora.getTime() - 26 * HORA - 1) });
    const s = avaliarSaudeAgente(passou, agora);
    expect(s.estado).toBe("atrasado");
    expect(s.alertas).toHaveLength(1);
    expect(s.alertas[0].nivel).toBe("alerta");
    expect(s.alertas[0].mensagem).toMatch(/^PDV sem sincronizar há 26 h \(último OK em /);
  });

  test("a data do ultimo OK sai no fuso de Sao Paulo, nao no do processo", () => {
    // 2026-10-12T02:00Z = 11/10 23:00 em Sao Paulo (UTC-3).
    const s = avaliarSaudeAgente(registro({ ultimoOkEm: new Date("2026-10-12T02:00:00.000Z") }), agora);
    expect(s.alertas[0].mensagem).toContain("11/10/2026 23:00");
  });

  test("passou de 48 h vira critico, com a mesma mensagem", () => {
    const s = avaliarSaudeAgente(registro({ ultimoOkEm: new Date(agora.getTime() - 49 * HORA) }), agora);
    expect(s.estado).toBe("critico");
    expect(s.alertas).toHaveLength(1);
    expect(s.alertas[0].nivel).toBe("critico");
    expect(s.alertas[0].mensagem).toMatch(/^PDV sem sincronizar há 49 h/);
  });

  test("48 h exatas ainda e alerta, nao critico", () => {
    const s = avaliarSaudeAgente(registro({ ultimoOkEm: new Date(agora.getTime() - 48 * HORA) }), agora);
    expect(s.estado).toBe("atrasado");
    expect(s.alertas[0].nivel).toBe("alerta");
  });

  test("erro e atraso aparecem juntos, o mais grave primeiro", () => {
    const s = avaliarSaudeAgente(
      registro({ ultimoStatus: "erro", ultimaMensagem: "timeout", ultimoOkEm: new Date(agora.getTime() - 60 * HORA) }),
      agora
    );
    expect(s.alertas.map((a) => a.nivel)).toEqual(["critico", "alerta"]);
    expect(s.estado).toBe("critico");
  });

  test("so houve erro ate hoje (nunca um OK): mostra o erro e nao inventa horas", () => {
    const s = avaliarSaudeAgente(registro({ ultimoStatus: "erro", ultimaMensagem: "x", ultimoOkEm: null, ultimoOkPeriodoFim: null }), agora);
    expect(s.horasSemOk).toBeNull();
    expect(s.alertas).toEqual([{ nivel: "alerta", mensagem: "Último sync do PDV falhou: x" }]);
  });

  test("devolve o periodo coberto pelo ultimo OK para a tela", () => {
    expect(avaliarSaudeAgente(registro({ ultimoOkPeriodoFim: "2026-10-12" }), agora).ultimoOkPeriodoFim).toBe("2026-10-12");
  });
});
