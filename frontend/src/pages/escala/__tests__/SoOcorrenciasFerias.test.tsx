import { render } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import type { ScheduleDayMeta, ScheduleDayType, ScheduleEmployee } from "../../../api/client";
import { SoOcorrencias } from "../SoOcorrencias";
import { TITULO_DAS_FERIAS } from "../feriasOrigem";

const funcionario = { id: "e1", firstName: "Ana", lastName: "Exemplo", displayName: "Ana", sector: "Salão", subgroup: null, admissionDate: "2025-01-01", terminationDate: null } as unknown as ScheduleEmployee;
const dias: ScheduleDayMeta[] = [1, 2, 3].map((day) => ({ day, dow: 1, isSunday: false, isHoliday: false, holidayName: null }));

const abrir = (origem: Record<number, "FOLHA" | "PROGRAMACAO">) =>
  render(
    <SoOcorrencias employees={[funcionario]} days={dias} year={2026} month={10} marks={new Map<string, ScheduleDayType>()}
      isFerias={(_id, day) => day in origem} origemDasFerias={(_id, day) => origem[day]}
      canEdit onMarcar={() => undefined} descartadas={0} nameCol={120} countCol={30} cell={24} compacto={false} />,
  );

beforeEach(() => { window.localStorage.clear(); });

describe("SoOcorrencias — origem das férias", () => {
  test("férias da folha e férias programadas têm textos diferentes", () => {
    window.localStorage.setItem("escala-so-ocorrencias-aberta", "1");
    abrir({ 1: "FOLHA", 2: "PROGRAMACAO" });
    const celulas = [...document.querySelectorAll("td[title]")].map((td) => td.getAttribute("title"));
    expect(celulas).toContain(TITULO_DAS_FERIAS.FOLHA);
    expect(celulas).toContain(TITULO_DAS_FERIAS.PROGRAMACAO);
    expect(document.querySelector('[aria-label*="Férias (programadas)"]')).not.toBeNull();
    expect(document.querySelector('[aria-label*="Férias (Folha)"]')).not.toBeNull();
  });
});
