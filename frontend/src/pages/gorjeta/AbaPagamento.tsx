import { FileText } from "lucide-react";
import { useMemo } from "react";
import type { TipComputation, TipComputedParticipant } from "../../api/client";
import { Alert, Button, Money, StatusBadge, Table } from "../../design-system";
import { exportarContabilidade, exportarListaPagamento } from "./exportarPdf";
import "./gorjeta.css";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";
import {
  type LocalRow, type RowPatch, estimarAdicionais, fmtDate, fmtHoras, inputStyle, money, mutedStyle, numInputStyle, ordenar, panelStyle, parseHoras,
} from "./gorjetaUtils";

const EXTRATORES: Extratores<TipComputedParticipant> = {
  nome: (p) => p.employeeName,
  empresa: (p) => p.companyName,
  gorjeta: (p) => p.rateioAmount,
  horaExtra: (p) => parseHoras(p.horaExtra),
  noturno: (p) => parseHoras(p.adicionalNoturno),
  faltas: (p) => p.faltas,
  atestados: (p) => p.atestados,
  salarioBase: (p) => p.baseSalary,
  dias: (p) => p.diasSalario,
  salario: (p) => p.salarioProporcional,
  vales: (p) => p.creditos - p.descontos,
  aPagar: (p) => p.totalAPagar,
  pix: (p) => p.pixKey,
};
const TEXTO = new Set(["nome", "empresa", "pix"]);

const COLUNAS_CONTAB: ColunaOpcional[] = [
  { chave: "empresa", rotulo: "Empresa" }, { chave: "gorjeta", rotulo: "Gorjeta" }, { chave: "horaExtra", rotulo: "Hora extra" },
  { chave: "noturno", rotulo: "Ad. noturno" }, { chave: "estimativa", rotulo: "Estimativa" }, { chave: "faltas", rotulo: "Faltas" },
  { chave: "atestados", rotulo: "Atestados" }, { chave: "justificada", rotulo: "Justificada" },
];
const COLUNAS_PAG: ColunaOpcional[] = [
  { chave: "salarioBase", rotulo: "Salário base" }, { chave: "dias", rotulo: "Dias" }, { chave: "salario", rotulo: "Salário" },
  { chave: "gorjeta", rotulo: "Gorjeta" }, { chave: "vales", rotulo: "Vales" }, { chave: "aPagar", rotulo: "A pagar" },
  { chave: "pix", rotulo: "PIX" },
];

type Props = {
  comp: TipComputation;
  rows: LocalRow[];
  readonly: boolean;
  onRow: RowPatch;
  onError: (message: string) => void;
};

export function AbaPagamento({ comp, rows, readonly, onRow, onError }: Props) {
  const rowPorFuncionario = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);
  const participantes = useMemo(() => ordenar(comp.participants).filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO"), [comp]);
  const registrados = participantes.filter((p) => !p.semRegistro && !p.reserva);
  const semRegistro = participantes.filter((p) => p.semRegistro && !p.reserva);
  const reserva = participantes.filter((p) => p.reserva);
  const veSalario = participantes.some((p) => p.baseSalary != null);
  const ordContab = useOrdenacao("contabilidade");
  const colC = useColunas("contabilidade");
  const colP = useColunas("pagamento");
  const vc = colC.visivel;
  const vp = colP.visivel;
  const ordPag = useOrdenacao("pagamento");
  const registradosOrd = useMemo(() => aplicarOrdem(registrados, ordContab.ordem, EXTRATORES), [registrados, ordContab.ordem]);
  const semRegistroOrd = useMemo(() => aplicarOrdem(semRegistro, ordPag.ordem, EXTRATORES), [semRegistro, ordPag.ordem]);
  const thC = (coluna: string) => ({ coluna, ordem: ordContab.ordem, onOrdenar: () => ordContab.alternar(coluna, TEXTO.has(coluna) ? "asc" : "desc") });
  const thP = (coluna: string) => ({ coluna, ordem: ordPag.ordem, onOrdenar: () => ordPag.alternar(coluna, TEXTO.has(coluna) ? "asc" : "desc") });

  async function exportar(fn: (c: TipComputation) => Promise<void>) {
    try { await fn(comp); } catch (e) { onError("Erro ao gerar o PDF: " + (e as Error).message); }
  }

  // Normaliza para h:mm ao sair do campo ("7,5" → "7:30").
  function normalizarHoras(employeeId: string, campo: "horaExtra" | "adicionalNoturno", valor: string) {
    const min = parseHoras(valor);
    onRow(employeeId, { [campo]: min == null ? "" : fmtHoras(min) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
        {[
          { label: "Contabilidade (gorjeta dos registrados)", valor: registrados.reduce((a, p) => a + p.rateioAmount, 0), detalhe: `${registrados.length} pessoas`, cor: "var(--info)" },
          { label: "Lista de pagamento (salário + gorjeta)", valor: semRegistro.reduce((a, p) => a + p.totalAPagar, 0), detalhe: `${semRegistro.length} sem registro`, cor: "var(--success)" },
          { label: "Fica na casa (reserva + saldo)", valor: comp.reservaTotal + Math.max(0, comp.saldo), detalhe: "não é pago", cor: "var(--gold)" },
        ].map((c) => (
          <div key={c.label} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", boxShadow: `inset 3px 0 0 ${c.cor}`, background: "var(--surface, #fff)" }}>
            <div style={mutedStyle}>{c.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{money(c.valor)}</div>
            <div style={{ ...mutedStyle, fontSize: 11 }}>{c.detalhe}</div>
          </div>
        ))}
      </div>
      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>Envio à contabilidade <span style={{ ...mutedStyle, fontWeight: 400 }}>— registrados, por empresa</span></strong>
          <div className="barra-lista">
            <SeletorColunas colunas={COLUNAS_CONTAB.filter((c) => veSalario || c.chave !== "estimativa")} ocultas={colC.ocultas} alternar={colC.alternar} mostrarTodas={colC.mostrarTodas} />
            <Button variant="secondary" leadingIcon={<FileText size={14} />} onClick={() => void exportar(exportarContabilidade)}>PDF contabilidade</Button>
          </div>
        </div>
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...thC("nome")} align="left" minWidth={180}>Funcionário</ThOrdenavel>
{vc("empresa") && (
              <ThOrdenavel {...thC("empresa")}>Empresa</ThOrdenavel>
)}
{vc("gorjeta") && (
              <ThOrdenavel {...thC("gorjeta")} align="center">Gorjeta</ThOrdenavel>
)}
{vc("horaExtra") && (
              <ThOrdenavel {...thC("horaExtra")}>Hora extra</ThOrdenavel>
)}
{vc("noturno") && (
              <ThOrdenavel {...thC("noturno")}>Ad. noturno</ThOrdenavel>
)}
              {veSalario && vc("estimativa") && <Table.Th>Estimativa</Table.Th>}
{vc("faltas") && (
              <ThOrdenavel {...thC("faltas")}>Faltas</ThOrdenavel>
)}
{vc("atestados") && (
              <ThOrdenavel {...thC("atestados")}>Atest.</ThOrdenavel>
)}
{vc("justificada") && (
              <Table.Th>Justificada</Table.Th>
)}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {registradosOrd.map((p) => {
              const r = rowPorFuncionario.get(p.employeeId);
              if (!r) return null;
              const est = estimarAdicionais(p.baseSalary, parseHoras(r.horaExtra), parseHoras(r.adicionalNoturno));
              return (
                <Table.Row key={p.employeeId}>
                  <Table.Td>
                    <div style={{ fontWeight: 500 }}>{p.employeeName}</div>
                    {p.tipoCalculo !== "MES" && <span style={mutedStyle}>Rescisão {fmtDate(p.terminationDate)}</span>}
                  </Table.Td>
{vc("empresa") && (
                  <Table.Td>{p.companyName ?? <span style={{ color: "var(--warning, #b45309)" }}>sem empresa</span>}</Table.Td>
)}
{vc("gorjeta") && (
                  <Table.Td><Money value={p.rateioAmount} /></Table.Td>
)}
{vc("horaExtra") && (
                  <Table.Td>
                    <input style={{ ...numInputStyle, width: 70 }} value={r.horaExtra} disabled={readonly} placeholder="0:00" aria-label="Hora extra"
                      onChange={(e) => onRow(p.employeeId, { horaExtra: e.target.value })}
                      onBlur={(e) => normalizarHoras(p.employeeId, "horaExtra", e.target.value)} />
                  </Table.Td>
)}
{vc("noturno") && (
                  <Table.Td>
                    <input style={{ ...numInputStyle, width: 70 }} value={r.adicionalNoturno} disabled={readonly} placeholder="0:00" aria-label="Adicional noturno"
                      onChange={(e) => onRow(p.employeeId, { adicionalNoturno: e.target.value })}
                      onBlur={(e) => normalizarHoras(p.employeeId, "adicionalNoturno", e.target.value)} />
                  </Table.Td>
)}
                  {veSalario && vc("estimativa") && (
                    <Table.Td style={mutedStyle} title={est ? `HE ${money(est.he)} · noturno ${money(est.noturno)}` : "Sem salário no cadastro"}>
                      {est && est.total > 0 ? money(est.total) : "—"}
                    </Table.Td>
                  )}
{vc("faltas") && (
                  <Table.Td>{p.faltas || "—"}</Table.Td>
)}
{vc("atestados") && (
                  <Table.Td>{p.atestados || "—"}</Table.Td>
)}
{vc("justificada") && (
                  <Table.Td>
                    <select style={{ ...inputStyle, width: 80 }} value={r.justificada ? "S" : "N"} disabled={readonly}
                      onChange={(e) => onRow(p.employeeId, { justificada: e.target.value === "S" })}>
                      <option value="N">Não</option>
                      <option value="S">Sim</option>
                    </select>
                  </Table.Td>
)}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
        <span style={mutedStyle}>
          Horas em h:mm (também aceita "7,5"). A estimativa é interna: hora = salário ÷ 220, HE 50%, noturno 20% sobre a hora de 52,5 min.
        </span>
      </div>

      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>Lista de pagamento <span style={{ ...mutedStyle, fontWeight: 400 }}>— sem registro: salário + gorjeta</span></strong>
          <div className="barra-lista">
            <SeletorColunas colunas={COLUNAS_PAG} ocultas={colP.ocultas} alternar={colP.alternar} mostrarTodas={colP.mostrarTodas} />
            <Button variant="secondary" leadingIcon={<FileText size={14} />} onClick={() => void exportar(exportarListaPagamento)}>PDF pagamento</Button>
          </div>
        </div>
        {!veSalario && semRegistro.length > 0 && (
          <Alert tone="warning">Salário e PIX só aparecem para quem tem permissão de ver Funcionários.</Alert>
        )}
        {semRegistro.length === 0
          ? <span style={mutedStyle}>Ninguém sem registro no período.</span>
          : (
            <Table className="tabela-gorjeta">
              <Table.Head>
                <Table.Row>
                  <ThOrdenavel {...thP("nome")} align="left" minWidth={180}>Funcionário</ThOrdenavel>
{vp("salarioBase") && (
                  <ThOrdenavel {...thP("salarioBase")}>Salário base</ThOrdenavel>
)}
{vp("dias") && (
                  <ThOrdenavel {...thP("dias")}>Dias</ThOrdenavel>
)}
{vp("salario") && (
                  <ThOrdenavel {...thP("salario")}>Salário</ThOrdenavel>
)}
{vp("gorjeta") && (
                  <ThOrdenavel {...thP("gorjeta")}>Gorjeta</ThOrdenavel>
)}
{vp("vales") && (
                  <ThOrdenavel {...thP("vales")}>Vales</ThOrdenavel>
)}
{vp("aPagar") && (
                  <ThOrdenavel {...thP("aPagar")}>A pagar</ThOrdenavel>
)}
{vp("pix") && (
                  <ThOrdenavel {...thP("pix")}>PIX</ThOrdenavel>
)}
                </Table.Row>
              </Table.Head>
              <Table.Body>
                {semRegistroOrd.map((p) => {
                  const r = rowPorFuncionario.get(p.employeeId);
                  if (!r) return null;
                  return (
                    <Table.Row key={p.employeeId}>
                      <Table.Td>
                        <div style={{ fontWeight: 500 }}>{p.employeeName}</div>
                        {p.tipoCalculo !== "MES" && <span style={mutedStyle}>Saída {fmtDate(p.terminationDate)}</span>}
                      </Table.Td>
{vp("salarioBase") && (
                      <Table.Td>{p.baseSalary != null ? money(p.baseSalary) : "—"}</Table.Td>
)}
{vp("dias") && (
                      <Table.Td>
                        <input style={{ ...numInputStyle, width: 52 }} type="number" min="0" max="31" step="1" value={r.diasSalarioOverride}
                          disabled={readonly} placeholder={String(p.diasSalario)} aria-label="Dias de salário"
                          title="Mês inteiro = 30; entrada/saída no meio = dias corridos; faltas descontam. Preencha só para corrigir."
                          onChange={(e) => onRow(p.employeeId, { diasSalarioOverride: e.target.value })} />
                      </Table.Td>
)}
{vp("salario") && (
                      <Table.Td><Money value={p.salarioProporcional} /></Table.Td>
)}
{vp("gorjeta") && (
                      <Table.Td><Money value={p.rateioAmount} /></Table.Td>
)}
{vp("vales") && (
                      <Table.Td>{p.descontos || p.creditos ? money(p.creditos - p.descontos) : "—"}</Table.Td>
)}
{vp("aPagar") && (
                      <Table.Td style={{ fontWeight: 700 }}><Money value={p.totalAPagar} /></Table.Td>
)}
{vp("pix") && (
                      <Table.Td style={mutedStyle}>{p.pixKey ?? "—"}</Table.Td>
)}
                    </Table.Row>
                  );
                })}
                <Table.Row>
                  <Table.Td style={{ fontWeight: 600 }}>Total</Table.Td>
                  {vp("salarioBase") && <Table.Td> </Table.Td>}
                  {vp("dias") && <Table.Td> </Table.Td>}
                  {vp("salario") && <Table.Td style={{ fontWeight: 600 }}><Money value={semRegistro.reduce((a, p) => a + p.salarioProporcional, 0)} /></Table.Td>}
                  {vp("gorjeta") && <Table.Td style={{ fontWeight: 600 }}><Money value={semRegistro.reduce((a, p) => a + p.rateioAmount, 0)} /></Table.Td>}
                  {vp("vales") && <Table.Td> </Table.Td>}
                  {vp("aPagar") && <Table.Td style={{ fontWeight: 700 }}><Money value={semRegistro.reduce((a, p) => a + p.totalAPagar, 0)} /></Table.Td>}
                  {vp("pix") && <Table.Td> </Table.Td>}
                </Table.Row>
              </Table.Body>
            </Table>
          )}
      </div>

      {(reserva.length > 0 || comp.saldo > 0) && (
        <div style={panelStyle}>
          <strong>Reserva da casa</strong>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
            {reserva.map((p) => (
              <span key={p.employeeId}>{p.employeeName} <StatusBadge tone="info">Reserva</StatusBadge>: <strong>{money(p.rateioAmount)}</strong></span>
            ))}
            {comp.saldo > 0 && <span>Saldo não distribuído: <strong>{money(comp.saldo)}</strong></span>}
            <span>Total retido: <strong>{money(comp.reservaTotal + Math.max(0, comp.saldo))}</strong></span>
          </div>
          <span style={mutedStyle}>Não entra na lista de pagamento nem no envio à contabilidade.</span>
        </div>
      )}
    </div>
  );
}
