import { useState } from "react";
import type { CSSProperties } from "react";
import type { ScheduleDayMeta, ScheduleDayType, ScheduleEmployee } from "../../api/client";
import {
  COLORS, DOW_LETTERS, MARCAS_OCORRENCIA, type MarcaOcorrencia, dataCurta, dateMs, fullName, keyOf,
  proximaOcorrencia, withinEmployment,
} from "./marcas";

// "Fora da escala — só ocorrências": quem tem "Entra na escala" desligado no cadastro.
// Não tem turno nem validação de descanso; aqui só se marca o que a gorjeta e o VT
// leem da escala (falta, atestado, férias e folga), na mesma tabela e do mesmo jeito.

const MARCA_POR_TIPO = new Map(MARCAS_OCORRENCIA.map((m) => [m.tipo as ScheduleDayType, m]));

type Props = {
  employees: ScheduleEmployee[];
  days: ScheduleDayMeta[];
  year: number;
  month: number;
  marks: Map<string, ScheduleDayType>;
  isFerias: (employeeId: string, day: number) => boolean;
  canEdit: boolean;
  onMarcar: (employeeId: string, day: number, tipo: ScheduleDayType | null) => void;
  /** Marcações de turno/evento de quando a pessoa estava na escala, descartadas ao carregar. */
  descartadas: number;
  nameCol: number;
  countCol: number;
  cell: number;
  compacto: boolean;
};

export function SoOcorrencias({ employees, days, year, month, marks, isFerias, canEdit, onMarcar, descartadas, nameCol, countCol, cell, compacto }: Props) {
  const [pincel, setPincel] = useState<MarcaOcorrencia | null>(null);

  const nomeStyle: CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, background: "var(--surface)",
    minWidth: nameCol, maxWidth: nameCol, borderRight: "1px solid var(--border-strong, var(--border))",
    padding: compacto ? "2px 10px" : "6px 10px", textAlign: "left",
  };
  const contaStyle: CSSProperties = {
    minWidth: countCol, maxWidth: countCol, textAlign: "center", fontWeight: 600,
    borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
  };

  function ocorrenciasNoMes(emp: ScheduleEmployee): number {
    return days.filter((d) => MARCA_POR_TIPO.has(marks.get(keyOf(emp.id, d.day)) as ScheduleDayType)).length;
  }

  return (
    <section aria-labelledby="so-ocorrencias-titulo" style={{ marginTop: 18 }}>
      <h3 id="so-ocorrencias-titulo" style={{ margin: "0 0 4px", fontSize: 14 }}>Fora da escala — só ocorrências</h3>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)", maxWidth: 760 }}>
        Quem está com “Entra na escala” desligado no cadastro. Aqui não há turno: marque só falta, atestado, férias e folga —
        valem para a gorjeta e o VT como na escala acima. Não entram na conferência de descanso nem saem no mural.
      </p>
      {descartadas > 0 && (
        <p role="status" style={{ margin: "0 0 8px", fontSize: 12, color: "#b45309" }}>
          {descartadas} marcação(ões) de turno de quando a pessoa estava na escala não valem aqui e somem ao salvar (não mudam gorjeta nem VT).
        </p>
      )}

      {canEdit && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", margin: "0 0 8px" }}>
          <span style={{ fontSize: 12, color: "var(--muted)", marginRight: 2 }}>Marcar com:</span>
          {MARCAS_OCORRENCIA.map((m) => {
            const ativo = pincel === m.tipo;
            return (
              <button
                key={m.tipo}
                type="button"
                title={m.ajuda}
                aria-pressed={ativo}
                onClick={() => setPincel(ativo ? null : m.tipo)}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "4px 10px", borderRadius: 999, font: "inherit", fontSize: 12,
                  fontWeight: ativo ? 700 : 500,
                  border: `1px solid ${ativo ? m.cor : "var(--border)"}`,
                  background: ativo ? m.cor : "transparent",
                  color: ativo ? "#fff" : "var(--text, inherit)",
                }}
              >
                <span style={{
                  display: "inline-grid", placeItems: "center", minWidth: 20, height: 16, padding: "0 2px", borderRadius: 3,
                  background: ativo ? "rgba(255,255,255,0.25)" : m.cor, color: "#fff", fontSize: 10, fontWeight: 700,
                }}>{m.letra}</span>
                {m.nome}
              </button>
            );
          })}
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 4 }}>
            {pincel ? "clique nas células para aplicar · clicar de novo limpa" : "nenhum selecionado — o clique cicla — → F → X → AT → —"}
          </span>
        </div>
      )}

      <div style={{ overflow: "auto", maxHeight: "50vh", border: "1px solid var(--border)", borderRadius: 10 }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...nomeStyle, top: 0, zIndex: 6, boxShadow: "inset 0 -1px 0 var(--border)", fontSize: 11, color: "var(--muted)" }}>Funcionário</th>
              <th
                style={{ position: "sticky", top: 0, zIndex: 5, background: "var(--surface)", minWidth: countCol, maxWidth: countCol, textAlign: "center", padding: "4px 2px", fontSize: 10, fontWeight: 500, color: "var(--muted)", boxShadow: "inset 0 -1px 0 var(--border)", borderLeft: "1px solid var(--border)" }}
                title="Ocorrências marcadas no mês"
              >Ocor.</th>
              {days.map((d) => (
                <th
                  key={d.day}
                  title={d.holidayName ?? undefined}
                  style={{
                    position: "sticky", top: 0, zIndex: 4, minWidth: cell, width: cell, textAlign: "center", padding: "4px 0", fontSize: 11,
                    background: d.isHoliday ? COLORS.feriado : d.isSunday ? COLORS.domingo : "var(--surface)",
                    color: d.isSunday || d.isHoliday ? "#1f2937" : "var(--muted)",
                    boxShadow: "inset 0 -1px 0 var(--border)",
                  }}
                >
                  <div style={{ fontWeight: 500, color: "var(--ink, inherit)" }}>{d.day}</div>
                  <div>{DOW_LETTERS[d.dow]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id}>
                <td style={nomeStyle}>
                  <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: nameCol - 20 }} title={fullName(emp)}>
                    {fullName(emp)}
                  </div>
                  {!emp.isActive && emp.terminationDate && (
                    <div style={{ fontSize: 10.5, color: "var(--danger, #b00)", fontWeight: 600 }}>Deslig. {dataCurta(emp.terminationDate)}</div>
                  )}
                  {!compacto && emp.sector && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{emp.sector}</div>}
                </td>
                <td style={contaStyle} title="Ocorrências marcadas no mês">{ocorrenciasNoMes(emp)}</td>
                {days.map((d) => {
                  const within = withinEmployment(emp, year, month, d.day);
                  const feriasFolha = isFerias(emp.id, d.day);
                  const marca = feriasFolha ? undefined : MARCA_POR_TIPO.get(marks.get(keyOf(emp.id, d.day)) as ScheduleDayType);
                  const bg = !within
                    ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(128,128,128,0.12) 3px, rgba(128,128,128,0.12) 6px)"
                    : feriasFolha ? COLORS.ferias
                      : marca ? marca.cor
                        : d.isHoliday ? COLORS.feriado
                          : d.isSunday ? COLORS.domingo
                            : "transparent";
                  const clicavel = within && !feriasFolha && canEdit;
                  const title = !within
                    ? (emp.terminationDate && dateMs(year, month, d.day) > new Date(emp.terminationDate).getTime()
                      ? `Desligado em ${dataCurta(emp.terminationDate)}` : "Fora do vínculo")
                    : feriasFolha ? "Férias (gerenciado na Folha)"
                      : marca ? marca.ajuda
                        : d.holidayName ?? (d.isSunday ? "Domingo" : undefined);
                  return (
                    <td
                      key={d.day}
                      onClick={clicavel ? () => onMarcar(emp.id, d.day, proximaOcorrencia(marks.get(keyOf(emp.id, d.day)), pincel)) : undefined}
                      title={title}
                      aria-label={`${fullName(emp)}, dia ${d.day}${marca ? `: ${marca.nome}` : ""}`}
                      style={{
                        minWidth: cell, width: cell, height: compacto ? 26 : 34, textAlign: "center",
                        borderLeft: "1px solid var(--border)", borderTop: "1px solid var(--border)",
                        background: bg, cursor: clicavel ? "pointer" : "default",
                        color: "#fff", fontWeight: 600, userSelect: "none",
                        fontSize: feriasFolha ? 9 : marca ? [undefined, undefined, 9, 8][marca.letra.length] : undefined,
                      }}
                    >
                      {within ? (feriasFolha ? "Fér" : marca ? marca.letra : "") : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
