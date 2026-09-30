import { FileText, Lock } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import type { TipComputation, TipComputedParticipant } from "../../api/client";
import { Alert, Button, Money, StatusBadge, Table } from "../../design-system";
import { exportarContabilidade, exportarListaPagamento } from "./exportarPdf";
import { SeloRecibo } from "./ReciboRescisao";
import "./gorjeta.css";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { BarraFiltro, opcoesDe, useFiltro } from "./filtro";
import { NomePessoa, textoPessoa } from "./NomePessoa";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";
import {
  type LocalRow, type RowPatch, NOTA_ADIANTAMENTO_OCULTO, adiantamentoOculto, estimarAdicionais, fmtDate, fmtHoras, inputStyle, money, mutedStyle, numInputStyle, ordenar, panelStyle, parseHoras, pts,
} from "./gorjetaUtils";

const EXTRATORES: Extratores<TipComputedParticipant> = {
  nome: (p) => p.employeeName,
  empresa: (p) => p.companyName,
  gorjeta: (p) => p.rateioAmount,
  lancar: (p) => p.netCommission,
  horaExtra: (p) => parseHoras(p.horaExtra),
  noturno: (p) => parseHoras(p.adicionalNoturno),
  faltas: (p) => p.faltas,
  atestados: (p) => p.atestados,
  salarioBase: (p) => p.baseSalary,
  dias: (p) => p.diasSalario,
  salario: (p) => p.salarioProporcional,
  adiantamento: (p) => p.adiantamentoSalarial ?? null,
  vales: (p) => p.creditos - p.descontos,
  aPagar: (p) => p.totalAPagar,
  pix: (p) => p.pixKey,
};
const TEXTO = new Set(["nome", "empresa", "pix", "justificada"]);

// Situação da pessoa no período, para o filtro de lista.
const situacao = (p: TipComputedParticipant) => (p.pagoNaRescisao ? "Paga na rescisão" : p.tipoCalculo === "MES" ? "No mês" : "Desligado no período");
const OPCOES_SITUACAO = ["No mês", "Desligado no período", "Paga na rescisão"].map((x) => ({ valor: x, rotulo: x }));
const totalTd: CSSProperties = { fontWeight: 600 };

const COLUNAS_CONTAB: ColunaOpcional[] = [
  { chave: "empresa", rotulo: "Empresa" }, { chave: "gorjeta", rotulo: "Gorjeta" }, { chave: "horaExtra", rotulo: "Hora extra" },
  { chave: "noturno", rotulo: "Ad. noturno" }, { chave: "estimativa", rotulo: "Estimativa" }, { chave: "faltas", rotulo: "Faltas" },
  { chave: "atestados", rotulo: "Atestados" }, { chave: "justificada", rotulo: "Justificada" },
];
const COLUNAS_PAG: ColunaOpcional[] = [
  { chave: "salarioBase", rotulo: "Salário base" }, { chave: "dias", rotulo: "Dias" }, { chave: "salario", rotulo: "Salário" },
  { chave: "adiantamento", rotulo: "Adiantamento" }, { chave: "gorjeta", rotulo: "Gorjeta" }, { chave: "vales", rotulo: "Vales" }, { chave: "aPagar", rotulo: "A pagar" },
  { chave: "pix", rotulo: "PIX" },
];

type Props = {
  comp: TipComputation;
  rows: LocalRow[];
  readonly: boolean;
  onRow: RowPatch;
  onError: (message: string) => void;
};

// Adiantamento já pago sai do total: aparece negativo pelo <Money> (respeita "ocultar valores").
// null = sem permissão de ver Funcionários: "oculto", nunca "—" (que leria como zero).
function CelulaAdiantamento({ valor }: { valor: number | null | undefined }) {
  if (valor == null) {
    return (
      <span style={{ ...mutedStyle, display: "inline-flex", alignItems: "center", gap: 4 }}
        title={`Sem permissão de ver o adiantamento. ${NOTA_ADIANTAMENTO_OCULTO}`}>
        <Lock size={12} aria-hidden="true" />oculto
      </span>
    );
  }
  return valor ? <Money value={-valor} /> : <>—</>;
}

export function AbaPagamento({ comp, rows, readonly, onRow, onError }: Props) {
  const rowPorFuncionario = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);
  const participantes = useMemo(() => ordenar(comp.participants).filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO"), [comp]);
  const registrados = participantes.filter((p) => !p.semRegistro);
  const semRegistro = participantes.filter((p) => p.semRegistro);
  // Gorjeta já paga dentro da rescisão (termo da contabilidade): aparece, mas não soma no que falta pagar.
  const registradosAPagar = registrados.filter((p) => !p.pagoNaRescisao);
  const pagasNaRescisao = participantes.filter((p) => p.pagoNaRescisao);
  const veSalario = participantes.some((p) => p.baseSalary != null);
  const ordContab = useOrdenacao("contabilidade");
  const colC = useColunas("contabilidade");
  const colP = useColunas("pagamento");
  const vc = colC.visivel;
  const vp = colP.visivel;
  const ordPag = useOrdenacao("pagamento");
  // Cada tabela com o seu filtro, na mesma chave da ordenação e das colunas.
  const filtroC = useFiltro("contabilidade");
  const filtroP = useFiltro("pagamento");
  const registradosFilt = filtroC.aplicar(registrados,
    (p) => [textoPessoa(p.employeeName, p.apelido), p.companyName ?? "", p.functionName ?? ""].join(" "),
    { empresa: (p) => p.companyName, situacao });
  const semRegistroFilt = filtroP.aplicar(semRegistro,
    (p) => [textoPessoa(p.employeeName, p.apelido), p.functionName ?? "", p.pixKey ?? ""].join(" "),
    { situacao });
  // Estimativa e justificada vêm do que foi digitado na tela, não da apuração.
  const extratoresContab: Extratores<TipComputedParticipant> = {
    ...EXTRATORES,
    estimativa: (p) => {
      const r = rowPorFuncionario.get(p.employeeId);
      return r ? estimarAdicionais(p.baseSalary, parseHoras(r.horaExtra), parseHoras(r.adicionalNoturno))?.total ?? null : null;
    },
    justificada: (p) => (rowPorFuncionario.get(p.employeeId)?.justificada ? "Sim" : "Não"),
  };
  const registradosOrd = aplicarOrdem(registradosFilt, ordContab.ordem, extratoresContab);
  const semRegistroOrd = aplicarOrdem(semRegistroFilt, ordPag.ordem, EXTRATORES);
  // Só o que se lança de verdade: a gorjeta já paga na rescisão fica fora, como no cartão acima.
  const aLancarFilt = registradosFilt.filter((p) => !p.pagoNaRescisao);
  const thC = (coluna: string) => ({ coluna, ordem: ordContab.ordem, onOrdenar: () => ordContab.alternar(coluna, TEXTO.has(coluna) ? "asc" : "desc") });
  const thP = (coluna: string) => ({ coluna, ordem: ordPag.ordem, onOrdenar: () => ordPag.alternar(coluna, TEXTO.has(coluna) ? "asc" : "desc") });

  // Adiantamento salarial já pago (sem registro que recebe no dia do adiantamento): sai do total.
  const totalAdiantamento = semRegistroFilt.reduce((a, p) => a + (p.adiantamentoSalarial ?? 0), 0);
  // Sem permissão o valor vem null: mostra "oculto" (não "—", que parece zero) e não expõe a regra.
  const adiantOculto = adiantamentoOculto(semRegistro);
  const tituloAdiantamento = adiantOculto
    ? `Adiantamento salarial já pago: sai do total. Sem permissão de ver o valor; ${NOTA_ADIANTAMENTO_OCULTO}`
    : comp.adiantamento
    ? `${comp.adiantamento.percent.toLocaleString("pt-BR")}% do salário base, pago no dia ${comp.adiantamento.dia}, para quem recebe adiantamento (cadastro). Já pago: sai do total.`
    : "Adiantamento salarial já pago: sai do total.";

  async function exportar(fn: (c: TipComputation) => Promise<void>) {
    try { await fn(comp); } catch (e) { onError("Erro ao gerar o PDF: " + (e as Error).message); }
  }

  // Normaliza para h:mm ao sair do campo ("7,5" → "7:30").
  function normalizarHoras(employeeId: string, campo: "horaExtra" | "adicionalNoturno", valor: string) {
    const min = parseHoras(valor);
    onRow(employeeId, { [campo]: min == null ? "" : fmtHoras(min) });
  }

  return (
    <div className="aba-pagamento" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="cards-totais">
        {[
          { label: "Contabilidade (gorjeta dos registrados)", valor: registradosAPagar.reduce((a, p) => a + p.netCommission, 0), detalhe: `${registradosAPagar.length} pessoas · gorjeta líquida (− vales)`, cor: "var(--info)" },
          ...(pagasNaRescisao.length ? [{ label: "Já pago nas rescisões", valor: pagasNaRescisao.reduce((a, p) => a + p.rateioAmount, 0), detalhe: `${pagasNaRescisao.length} pessoa(s) · não pagar de novo`, cor: "var(--muted)" }] : []),
          { label: "Lista de pagamento (salário − adiantamento + gorjeta)", valor: semRegistro.reduce((a, p) => a + p.totalAPagar, 0), detalhe: `${semRegistro.length} sem registro`, cor: "var(--success)" },
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
            <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} onClick={() => void exportar(exportarContabilidade)}>PDF contabilidade</Button>
          </div>
        </div>
        <BarraFiltro filtro={filtroC} total={registrados.length} visiveis={registradosFilt.length} placeholder="Filtrar por nome, apelido, empresa…"
          listas={[
            { chave: "empresa", rotulo: "Empresa", opcoes: opcoesDe(registrados, (p) => p.companyName) },
            { chave: "situacao", rotulo: "Situação", opcoes: OPCOES_SITUACAO },
          ]} />
        {filtroC.ativo && registradosFilt.length === 0 && <span style={mutedStyle}>Ninguém bate com o filtro.</span>}
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...thC("nome")} align="left" minWidth={180}>Funcionário</ThOrdenavel>
{vc("empresa") && (
              <ThOrdenavel {...thC("empresa")}>Empresa</ThOrdenavel>
)}
{vc("gorjeta") && (
              <ThOrdenavel {...thC("lancar")} align="center" title="Rateio − vales + créditos: é o que a contabilidade lança">Gorjeta a lançar</ThOrdenavel>
)}
{vc("horaExtra") && (
              <ThOrdenavel {...thC("horaExtra")}>Hora extra</ThOrdenavel>
)}
{vc("noturno") && (
              <ThOrdenavel {...thC("noturno")}>Ad. noturno</ThOrdenavel>
)}
              {veSalario && vc("estimativa") && <ThOrdenavel {...thC("estimativa")}>Estimativa</ThOrdenavel>}
{vc("faltas") && (
              <ThOrdenavel {...thC("faltas")}>Faltas</ThOrdenavel>
)}
{vc("atestados") && (
              <ThOrdenavel {...thC("atestados")}>Atest.</ThOrdenavel>
)}
{vc("justificada") && (
              <ThOrdenavel {...thC("justificada")}>Justificada</ThOrdenavel>
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
                    <NomePessoa nome={p.employeeName} apelido={p.apelido}>
                      {p.pagoNaRescisao
                        ? <SeloRecibo pago pagamento={p.rescisaoRecibo?.pagamento ?? null} arquivo={p.rescisaoRecibo?.arquivo} />
                        : p.tipoCalculo !== "MES" && <span style={mutedStyle}>Rescisão {fmtDate(p.terminationDate)}</span>}
                    </NomePessoa>
                  </Table.Td>
{vc("empresa") && (
                  <Table.Td>{p.companyName ?? <span style={{ color: "var(--warning, #b45309)" }}>sem empresa</span>}</Table.Td>
)}
{vc("gorjeta") && (
                  <Table.Td className={p.pagoNaRescisao ? "valor-ja-pago" : undefined} title={p.pagoNaRescisao ? "Já pago na rescisão — não entra no envio do mês" : undefined}>
                    <div style={{ fontWeight: 700 }}><Money value={p.netCommission} /></div>
                    {p.valesTotal !== 0 && <div style={mutedStyle}>rateio {money(p.rateioAmount)} · vales {money(-p.valesTotal)}</div>}
                  </Table.Td>
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
            <Table.Row>
              <Table.Td style={totalTd}>{filtroC.ativo ? `Total do filtro (${registradosFilt.length} de ${registrados.length})` : "Total a lançar"}</Table.Td>
              {vc("empresa") && <Table.Td> </Table.Td>}
              {vc("gorjeta") && (
                <Table.Td style={{ fontWeight: 700 }} title="Sem a gorjeta já paga nas rescisões">
                  <Money value={aLancarFilt.reduce((a, p) => a + p.netCommission, 0)} />
                </Table.Td>
              )}
              {vc("horaExtra") && <Table.Td> </Table.Td>}
              {vc("noturno") && <Table.Td> </Table.Td>}
              {veSalario && vc("estimativa") && <Table.Td> </Table.Td>}
              {vc("faltas") && <Table.Td> </Table.Td>}
              {vc("atestados") && <Table.Td> </Table.Td>}
              {vc("justificada") && <Table.Td> </Table.Td>}
            </Table.Row>
          </Table.Body>
        </Table>
        <span style={mutedStyle}>
          Horas em h:mm (também aceita "7,5"). A estimativa é interna: hora = salário ÷ 220, HE 50%, noturno 20% sobre a hora de 52,5 min.
        </span>
      </div>

      <div style={panelStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <strong>Lista de pagamento <span style={{ ...mutedStyle, fontWeight: 400 }}>— sem registro: salário − adiantamento + gorjeta</span></strong>
          <div className="barra-lista">
            <SeletorColunas colunas={COLUNAS_PAG} ocultas={colP.ocultas} alternar={colP.alternar} mostrarTodas={colP.mostrarTodas} />
            <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} onClick={() => void exportar(exportarListaPagamento)}>PDF pagamento</Button>
          </div>
        </div>
        {!veSalario && semRegistro.length > 0 && (
          <Alert tone="warning">Salário e PIX só aparecem para quem tem permissão de ver Funcionários.</Alert>
        )}
        {adiantOculto && semRegistro.length > 0 && vp("adiantamento") && (
          <span style={mutedStyle}>Adiantamento oculto (sem permissão): {NOTA_ADIANTAMENTO_OCULTO}</span>
        )}
        {semRegistro.length > 0 && (
          <BarraFiltro filtro={filtroP} total={semRegistro.length} visiveis={semRegistroFilt.length} placeholder="Filtrar por nome, apelido, PIX…"
            listas={[{ chave: "situacao", rotulo: "Situação", opcoes: OPCOES_SITUACAO.filter((o) => o.valor !== "Paga na rescisão") }]} />
        )}
        {filtroP.ativo && semRegistro.length > 0 && semRegistroFilt.length === 0 && <span style={mutedStyle}>Ninguém bate com o filtro.</span>}
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
{vp("adiantamento") && (
                  <ThOrdenavel {...thP("adiantamento")} title={tituloAdiantamento}>Adiantamento</ThOrdenavel>
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
                        <NomePessoa nome={p.employeeName} apelido={p.apelido}>
                          {p.tipoCalculo !== "MES" && <span style={mutedStyle}>Saída {fmtDate(p.terminationDate)}</span>}
                        </NomePessoa>
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
{vp("adiantamento") && (
                      <Table.Td><CelulaAdiantamento valor={p.adiantamentoSalarial} /></Table.Td>
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
                  <Table.Td style={totalTd}>{filtroP.ativo ? `Total do filtro (${semRegistroFilt.length} de ${semRegistro.length})` : "Total"}</Table.Td>
                  {vp("salarioBase") && <Table.Td> </Table.Td>}
                  {vp("dias") && <Table.Td> </Table.Td>}
                  {vp("salario") && <Table.Td style={totalTd}><Money value={semRegistroFilt.reduce((a, p) => a + p.salarioProporcional, 0)} /></Table.Td>}
                  {vp("adiantamento") && <Table.Td style={totalTd}><CelulaAdiantamento valor={adiantOculto ? null : totalAdiantamento} /></Table.Td>}
                  {vp("gorjeta") && <Table.Td style={totalTd}><Money value={semRegistroFilt.reduce((a, p) => a + p.rateioAmount, 0)} /></Table.Td>}
                  {vp("vales") && <Table.Td> </Table.Td>}
                  {vp("aPagar") && <Table.Td style={{ fontWeight: 700 }}><Money value={semRegistroFilt.reduce((a, p) => a + p.totalAPagar, 0)} /></Table.Td>}
                  {vp("pix") && <Table.Td> </Table.Td>}
                </Table.Row>
              </Table.Body>
            </Table>
          )}
      </div>

      <div style={panelStyle}>
        <strong>Fundo de reserva da gorjeta</strong>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline", fontVariantNumeric: "tabular-nums" }}>
          <span>Reserva deste período ({pts(comp.reservaPontos)} pts): <strong>{money(comp.reservaTotal)}</strong></span>
          <span>Saldo não distribuído: <strong>{money(Math.max(0, comp.saldo))}</strong></span>
          <span>Entra no fundo ao fechar: <strong>{money(comp.reservaTotal + Math.max(0, comp.saldo))}</strong></span>
          <span>Saldo atual do fundo: <strong>{money(comp.fundoReservaSaldo)}</strong></span>
        </div>
        <span style={mutedStyle}>Não entra na lista de pagamento nem no envio à contabilidade. Extrato, ajustes e distribuição ficam em Relatórios → Fundo de reserva.</span>
      </div>
    </div>
  );
}
