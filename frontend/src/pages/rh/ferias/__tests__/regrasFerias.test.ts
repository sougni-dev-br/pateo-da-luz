import { describe, expect, test } from "vitest";
import { motivoInicioVedado, prazoParaPagar, proximoInicioValido } from "../regrasFerias";

const FERIADOS = { "2026-11-20": "Consciência Negra", "2026-12-25": "Natal" };

describe("início das férias (CLT, art. 134, § 3º)", () => {
  test("feriado, domingo e os dois dias antes do repouso ou do feriado são vedados", () => {
    expect(motivoInicioVedado("2026-11-20", FERIADOS)).toMatch(/feriado/);
    expect(motivoInicioVedado("2026-12-13", FERIADOS)).toMatch(/domingo/);
    expect(motivoInicioVedado("2026-12-12", FERIADOS)).toMatch(/sábado está a 1 dia do repouso/);
    expect(motivoInicioVedado("2026-12-11", FERIADOS)).toMatch(/sexta-feira está a 2 dias do repouso/);
    expect(motivoInicioVedado("2026-12-23", FERIADOS)).toMatch(/faltam 2 dias para o feriado Natal/);
  });

  test("segunda a quinta comuns são permitidos", () => {
    expect(motivoInicioVedado("2026-12-07", FERIADOS)).toBeNull();
    expect(motivoInicioVedado("2026-12-10", FERIADOS)).toBeNull();
  });

  test("o próximo dia permitido pula o fim de semana e o feriado", () => {
    expect(proximoInicioValido("2026-12-11", FERIADOS)).toBe("2026-12-14");
    expect(proximoInicioValido("2026-12-23", FERIADOS)).toBe("2026-12-28");
    expect(proximoInicioValido("2026-12-07", FERIADOS)).toBe("2026-12-07");
  });

  test("o pagamento é até 2 dias antes", () => {
    expect(prazoParaPagar("2026-12-07")).toBe("2026-12-05");
  });
});
