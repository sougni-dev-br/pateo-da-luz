import { FileText, Lock, Receipt } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { type AcertosListaLancados, type TipComputation, type TipComputedParticipant, lancarAcertosLista } from "../../api/client";
import { useSession } from "../../context/SessionContext";
import { Alert, Button, Money, StatusBadge, Table } from "../../design-system";
import { hasPermission } from "../../lib/permissions";
import { exportarContabilidade, exportarListaPagamento } from "./exportarPdf";
import { NOTA_TETO_OCULTO, gorjetaEnviada } from "./envioContabilidade";
import { SeloRecibo } from "./ReciboRescisao";
import "./gorjeta.css";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { BarraFiltro, opcoesDe, useFiltro } from "./filtro";
import { NomePessoa, textoPessoa } from "./NomePessoa";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";
import {
  type LocalRow, type RowPatch, NOTA_ADIANTAMENTO_OCULTO, NOTA_HORA_EXTRA_OCULTA, NOTA_QUINZENA_OCULTA, REGRA_HORA_EXTRA, REGRA_QUINZENA,
  adiantamentoOculto, estimarAdicionais, fmtDate, fmtHoras, inputStyle, money, mostraQuinzena, mutedStyle, numInputStyle, ordenar, panelStyle,
  parseHoras, pts, quinzenaOculta, valorHoraExtraTotal,
} from "./gorjetaUtils";

const EXTRATORES: Extratores<TipComputedParticipant> = {
  nome: (p) => p.employeeName,
  empresa: (p) => p.companyName,
  gorjeta: (p) => p.rateioAmount,
  lancar: (p) => gorjetaEnviada(p),
  horaExtra: (p) => parseHoras(p.horaExtra),
  noturno: (p) => parseHoras(p.adicionalNoturno),
  faltas: (p) => p.faltas,
  atestados: (p) => p.atestados,
  salarioBase: (p) => p.baseSalary,
  dias: (p) => p.diasSalario,
  salario: (p) => p.salarioProporcional,
  adiantamento: (p) => p.adiantamentoSalarial ?? null,
  quinzena: (p) => p.primeiraQuinzena ?? null,
  valorHe: (p) => valorHoraExtraTotal(p),
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
  { chave: "adiantamento", rotulo: "Adiantamento" }, { chave: "quinzena", rotulo: "1ª quinzena (15)" }, { chave: "gorjeta", rotulo: "Gorjeta" }, { chave: "vales", rotulo: "Vales" },
  { chave: "horaExtra", rotulo: "Hora extra" }, { chave: "noturno", rotulo: "Ad. noturno" }, { chave: "valorHe", rotulo: "Valor HE/noturno" },
  { chave: "aPagar", rotulo: "A pagar" },
  { chave: "pix", rotulo: "PIX" },
];

type Props = {
  comp: TipComputation;
  rows: LocalRow[];
  readonly: boolean;
  onRow: RowPatch;
  onError: (message: string) => void;
};

// Adiantamento (ou 1ª quinzena) já pago sai do total: aparece negativo pelo <Money> (respeita
// "ocultar valores"). null = sem permissão de ver Funcionários: "oculto", nunca "—" (que leria como zero).
function CelulaAdiantamento({ valor, oculto = `Sem permissão de ver o adiantamento. ${NOTA_ADIANTAMENTO_OCULTO}` }: {
  valor: number | null | undefined; oculto?: string;
}) {
  if (valor == null) {
    return (
      <span style={{ ...mutedStyle, display: "inline-flex", alignItems: "center", gap: 4 }}
        title={oculto}>
        <Lock size={12} aria-hidden="true" />oculto
      </span>
    );
  }
  return valor ? <Money value={-valor} /> : <>—</>;
}

// Soma do que vai à contabilidade; null se alguém pelo teto está oculto (o total seria parcial).
function somaEnviada(lista: TipComputedParticipant[]): number | null {
  const valores = lista.map(gorjetaEnviada);
  return valores.some((v) => v == null) ? null : valores.reduce<number>((a, v) => a + (v ?? 0), 0);
}

// Gorjeta a lançar: a informada. Pelo teto do IR, selo com a gorjeta real (só na tela, nunca no PDF).
function CelulaGorjetaEnviada({ p }: { p: TipComputedParticipant }) {
  const valor = gorjetaEnviada(p);
  if (valor == null) {
    return <span style={mutedStyle} title={NOTA_TETO_OCULTO}>— <span className="selo-teto-ir">pelo teto do IR</span></span>;
  }
  return (
    <>
      <div style={{ fontWeight: 700 }}><Money value={valor} /></div>
      {p.gorjetaInformadaPeloTeto && (
        <div title={`gorjeta real ${money(p.netCommission)}; a diferença ele recebe na lista de pagamento`}>
          <StatusBadge tone="info">pelo teto do IR</StatusBadge>
        </div>
      )}
    </>
  );
}

// Hora extra + noturno já somados ao A pagar. null = sem permissão (deriva do salário): "oculto".
function CelulaValorHoraExtra({ valor, titulo }: { valor: number | null; titulo?: string }) {
  if (valor == null) {
    return (
      <span style={{ ...mutedStyle, display: "inline-flex", alignItems: "center", gap: 4 }}
        title={`Sem permissão de ver o valor da hora extra. ${NOTA_HORA_EXTRA_OCULTA}`}>
        <Lock size={12} aria-hidden="true" />oculto
      </span>
    );
  }
  return valor ? <span title={titulo}><Money value={valor} /></span> : <>—</>;
}

const somaHoras = (lista: Array<string | undefined>) => lista.reduce((a, t) => a + Math.max(0, parseHoras(t) ?? 0), 0);

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

// O que o "Lançar acertos" fez. Nomes e valores só vêm para quem vê Funcionários (detalhes).
function ResultadoAcertos({ r }: { r: AcertosListaLancados }) {
  const resumo = [plural(r.criados, "criado", "criados"), plural(r.atualizados, "atualizado", "atualizados"), `${r.semMudanca} sem mudança`].join(" · ");
  return (
    <Alert tone={r.avisos.length ? "warning" : "success"} style={{ fontSize: 13 }}>
      <div>Acertos no Contas a Pagar (Folha · Salário (acerto)): {resumo}.</div>
      {r.detalhes?.criados.map((c) => (
        <div key={`c-${c.employeeId}`}>{c.nome}: <Money value={c.valor} /> · vence {dataBr(c.vencimento)}</div>
      ))}
      {r.detalhes?.atualizados.map((a) => (
        <div key={`a-${a.employeeId}`}>{a.nome}: <Money value={a.antes} /> → <Money value={a.depois} /></div>
      ))}
      {r.avisos.map((a, i) => <div key={`aviso-${i}`}>{a}</div>)}
    </Alert>
  );
}

export function AbaPagamento({ comp, rows, readonly, onRow, onError }: Props) {
  const { user } = useSession();
  // Lançar os acertos grava na Folha (Contas a Pagar): exige editar a Folha e, como o resto da
  // aba, editar a gorjeta. Período fechado não bloqueia aqui: o servidor lança o valor gravado no
  // fechamento ou recusa (mês financeiro travado), e a recusa aparece junto do botão.
  const podeLancarAcertos = hasPermission(user, "payroll", "edit") && hasPermission(user, "payroll-tips", "edit");
  const [lancando, setLancando] = useState(false);
  // O resultado e a recusa valem só para o mês em que foram pedidos.
  const mesAtual = `${comp.year}-${comp.month}`;
  const mesRef = useRef(mesAtual);
  mesRef.current = mesAtual;
  const [acertos, setAcertos] = useState<{ mes: string; r: AcertosListaLancados } | null>(null);
  const [recusaAcertos, setRecusaAcertos] = useState<{ mes: string; mensagem: string } | null>(null);
  useEffect(() => { setAcertos(null); setRecusaAcertos(null); }, [mesAtual]);
  const rowPorFuncionario = useMemo(() => new Map(rows.map((r) => [r.employeeId, r])), [rows]);
  const participantes = useMemo(() => ordenar(comp.participants).filter((p) => p.tipoCalculo !== "FORA_DO_PERIODO"), [comp]);
  // Quem só está pelo salário não vai à contabilidade (não tem gorjeta a lançar).
  const registrados = participantes.filter((p) => !p.semRegistro && !p.foraDaGorjeta);
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
  const totalALancar = somaEnviada(aLancarFilt);
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
  // 1ª quinzena (sem registro por quinzena): coluna só quando alguém recebe, ou oculta sem permissão.
  const comQuinzena = mostraQuinzena(semRegistro);
  const qOculta = quinzenaOculta(semRegistro);
  // Quem foi pago na rescisão tem a quinzena descontada lá (o total a pagar dele é zero).
  const totalQuinzena = semRegistroFilt.filter((p) => !p.pagoNaRescisao).reduce((a, p) => a + (p.primeiraQuinzena ?? 0), 0);
  const tituloQuinzena = qOculta ? `1ª quinzena já paga: sai do total. Sem permissão de ver o valor; ${NOTA_QUINZENA_OCULTA}` : REGRA_QUINZENA;
  const vq = comQuinzena && vp("quinzena");
  // O resumo do topo e o título da lista dizem o que sai do salário.
  const formula = `salário − adiantamento${comQuinzena ? " − 1ª quinzena" : ""} + gorjeta − vales + créditos + hora extra e noturno`;
  // Hora extra e noturno (sem registro): o total não leva quem foi pago na rescisão (recebe lá).
  const heOculta = semRegistro.some((p) => valorHoraExtraTotal(p) == null);
  const totalValorHe = semRegistroFilt.filter((p) => !p.pagoNaRescisao).reduce((a, p) => a + (valorHoraExtraTotal(p) ?? 0), 0);
  const horasDe = (campo: "horaExtra" | "adicionalNoturno") => somaHoras(semRegistroFilt.map((p) => rowPorFuncionario.get(p.employeeId)?.[campo]));
  const tituloValorHe = (p: TipComputedParticipant) => [
    `HE ${money(p.valorHoraExtra)} · noturno ${money(p.valorAdicionalNoturno)}`,
    p.pagoNaRescisao ? "Paga na rescisão (não entra no A pagar da lista)" : null,
  ].filter(Boolean).join(". ");

  async function exportar(fn: (c: TipComputation) => Promise<void>) {
    try { await fn(comp); } catch (e) { onError("Erro ao gerar o PDF: " + (e as Error).message); }
  }

  async function lancarAcertos() {
    const mes = mesAtual;
    setLancando(true);
    setAcertos(null);
    setRecusaAcertos(null);
    try {
      const r = await lancarAcertosLista(comp.year, comp.month);
      if (mesRef.current === mes) setAcertos({ mes, r });
    } catch (e) {
      const mensagem = (e as Error).message;
      if (mesRef.current === mes) setRecusaAcertos({ mes, mensagem });
      onError("Erro ao lançar os acertos: " + mensagem);
    } finally { setLancando(false); }
  }
  const mostraLancarAcertos = podeLancarAcertos && Boolean(comp.periodId) && semRegistro.length > 0;

  // Normaliza para h:mm ao sair do campo ("7,5" → "7:30").
  function normalizarHoras(employeeId: string, campo: "horaExtra" | "adicionalNoturno", valor: string) {
    const min = parseHoras(valor);
    onRow(employeeId, { [campo]: min == null ? "" : fmtHoras(min) });
  }

  return (
    <div className="aba-pagamento" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="cards-totais">
        {[
          { label: "Contabilidade (gorjeta dos registrados)", valor: somaEnviada(registradosAPagar), detalhe: `${registradosAPagar.length} pessoas · gorjeta líquida (− vales)`, cor: "var(--info)" },
          ...(pagasNaRescisao.length ? [{ label: "Já pago nas rescisões", valor: pagasNaRescisao.reduce((a, p) => a + p.rateioAmount, 0), detalhe: `${pagasNaRescisao.length} pessoa(s) · não pagar de novo`, cor: "var(--muted)" }] : []),
          { label: `Lista de pagamento (${formula})`, valor: semRegistro.reduce((a, p) => a + p.totalAPagar, 0), detalhe: `${semRegistro.length} sem registro`, cor: "var(--success)" },
          { label: "Fica na casa (reserva + saldo)", valor: comp.reservaTotal + Math.max(0, comp.saldo), detalhe: "não é pago", cor: "var(--gold)" },
        ].map((c) => (
          <div key={c.label} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", boxShadow: `inset 3px 0 0 ${c.cor}`, background: "var(--surface, #fff)" }}>
            <div style={mutedStyle}>{c.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title={c.valor == null ? NOTA_TETO_OCULTO : undefined}>{money(c.valor)}</div>
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
              <ThOrdenavel {...thC("lancar")} align="center" title="Rateio − vales + créditos (com teto do IR: teto − salário registrado): é o que a contabilidade lança">Gorjeta a lançar</ThOrdenavel>
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
                    <CelulaGorjetaEnviada p={p} />
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
                <Table.Td style={{ fontWeight: 700 }} title={totalALancar == null ? NOTA_TETO_OCULTO : "Sem a gorjeta já paga nas rescisões"}>
                  {totalALancar == null ? "—" : <Money value={totalALancar} />}
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
          <strong>Lista de pagamento <span style={{ ...mutedStyle, fontWeight: 400 }}>— sem registro: {formula}</span></strong>
          <div className="barra-lista">
            <SeletorColunas colunas={COLUNAS_PAG.filter((c) => comQuinzena || c.chave !== "quinzena")} ocultas={colP.ocultas} alternar={colP.alternar} mostrarTodas={colP.mostrarTodas} />
            <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} onClick={() => void exportar(exportarListaPagamento)}>PDF pagamento</Button>
            {mostraLancarAcertos && (
              <Button variant="secondary" size="sm" leadingIcon={<Receipt size={14} />} onClick={() => void lancarAcertos()} disabled={lancando}
                title="Cria (ou atualiza, se ainda não foi pago) um título Salário (acerto) por sem registro, com o A pagar da lista. Vence no fim do mês para quem recebe por quinzena; no 5º dia útil do mês seguinte para os outros. Pago não muda; excluído à mão não volta. Fechar a gorjeta já lança.">
                {lancando ? "Lançando…" : "Lançar acertos no Contas a Pagar"}
              </Button>
            )}
          </div>
        </div>
        {acertos && acertos.mes === mesAtual && <ResultadoAcertos r={acertos.r} />}
        {recusaAcertos && recusaAcertos.mes === mesAtual && (
          <Alert tone="error" role="alert" style={{ fontSize: 13 }}>Acertos não lançados: {recusaAcertos.mensagem}</Alert>
        )}
        {!veSalario && semRegistro.length > 0 && (
          <Alert tone="warning">Salário e PIX só aparecem para quem tem permissão de ver Funcionários.</Alert>
        )}
        {adiantOculto && semRegistro.length > 0 && vp("adiantamento") && (
          <span style={mutedStyle}>Adiantamento oculto (sem permissão): {NOTA_ADIANTAMENTO_OCULTO}</span>
        )}
        {qOculta && semRegistro.length > 0 && vq && (
          <span style={mutedStyle}>1ª quinzena oculta (sem permissão): {NOTA_QUINZENA_OCULTA}</span>
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
{vq && (
                  <ThOrdenavel {...thP("quinzena")} title={tituloQuinzena}>1ª quinzena (15)</ThOrdenavel>
)}
{vp("gorjeta") && (
                  <ThOrdenavel {...thP("gorjeta")}>Gorjeta</ThOrdenavel>
)}
{vp("vales") && (
                  <ThOrdenavel {...thP("vales")}>Vales</ThOrdenavel>
)}
{vp("horaExtra") && (
                  <ThOrdenavel {...thP("horaExtra")} title="Horas extras do período, em h:mm (pagas com 50%)">Hora extra</ThOrdenavel>
)}
{vp("noturno") && (
                  <ThOrdenavel {...thP("noturno")} title="Horas noturnas do período, em h:mm">Ad. noturno</ThOrdenavel>
)}
{vp("valorHe") && (
                  <ThOrdenavel {...thP("valorHe")} title={`${REGRA_HORA_EXTRA} Já soma no A pagar.`}>Valor HE/noturno</ThOrdenavel>
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
                          {p.foraDaGorjeta && <StatusBadge tone="neutral" title="Não participa da gorjeta: recebe só o salário (com hora extra e vales)">fora da gorjeta</StatusBadge>}
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
{vq && (
                      <Table.Td><CelulaAdiantamento valor={p.primeiraQuinzena === undefined ? 0 : p.primeiraQuinzena}
                        oculto={`Sem permissão de ver a 1ª quinzena. ${NOTA_QUINZENA_OCULTA}`} /></Table.Td>
)}
{vp("gorjeta") && (
                      <Table.Td>{p.foraDaGorjeta ? <span style={mutedStyle} title="não participa da gorjeta">—</span> : <Money value={p.rateioAmount} />}</Table.Td>
)}
{vp("vales") && (
                      <Table.Td>{p.descontos || p.creditos ? money(p.creditos - p.descontos) : "—"}</Table.Td>
)}
{vp("horaExtra") && (
                      <Table.Td>
                        <input style={{ ...numInputStyle, width: 70 }} value={r.horaExtra} disabled={readonly} placeholder="0:00" aria-label="Hora extra"
                          onChange={(e) => onRow(p.employeeId, { horaExtra: e.target.value })}
                          onBlur={(e) => normalizarHoras(p.employeeId, "horaExtra", e.target.value)} />
                      </Table.Td>
)}
{vp("noturno") && (
                      <Table.Td>
                        <input style={{ ...numInputStyle, width: 70 }} value={r.adicionalNoturno} disabled={readonly} placeholder="0:00" aria-label="Adicional noturno"
                          onChange={(e) => onRow(p.employeeId, { adicionalNoturno: e.target.value })}
                          onBlur={(e) => normalizarHoras(p.employeeId, "adicionalNoturno", e.target.value)} />
                      </Table.Td>
)}
{vp("valorHe") && (
                      <Table.Td className={p.pagoNaRescisao ? "valor-ja-pago" : undefined}>
                        <CelulaValorHoraExtra valor={valorHoraExtraTotal(p)} titulo={tituloValorHe(p)} />
                      </Table.Td>
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
                  {vq && (
                    <Table.Td style={totalTd} title="Sem quem foi pago na rescisão">
                      <CelulaAdiantamento valor={qOculta ? null : totalQuinzena} oculto={`Sem permissão de ver a 1ª quinzena. ${NOTA_QUINZENA_OCULTA}`} />
                    </Table.Td>
                  )}
                  {vp("gorjeta") && <Table.Td style={totalTd}><Money value={semRegistroFilt.reduce((a, p) => a + p.rateioAmount, 0)} /></Table.Td>}
                  {vp("vales") && <Table.Td> </Table.Td>}
                  {vp("horaExtra") && <Table.Td style={totalTd}>{fmtHoras(horasDe("horaExtra") || null)}</Table.Td>}
                  {vp("noturno") && <Table.Td style={totalTd}>{fmtHoras(horasDe("adicionalNoturno") || null)}</Table.Td>}
                  {vp("valorHe") && (
                    <Table.Td style={totalTd} title="Sem quem foi pago na rescisão">
                      <CelulaValorHoraExtra valor={heOculta ? null : totalValorHe} />
                    </Table.Td>
                  )}
                  {vp("aPagar") && <Table.Td style={{ fontWeight: 700 }}><Money value={semRegistroFilt.reduce((a, p) => a + p.totalAPagar, 0)} /></Table.Td>}
                  {vp("pix") && <Table.Td> </Table.Td>}
                </Table.Row>
              </Table.Body>
            </Table>
          )}
        {semRegistro.length > 0 && (
          <span style={mutedStyle}>
            Horas em h:mm (também aceita "7,5"); o valor recalcula ao gravar (automático). {REGRA_HORA_EXTRA} Entra no A pagar.
            {heOculta && ` Valor oculto (sem permissão): ${NOTA_HORA_EXTRA_OCULTA}`}
          </span>
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
