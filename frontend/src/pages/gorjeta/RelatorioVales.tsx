// Relatório de vales: todos os lançamentos de um intervalo de competências,
// com os cancelados (e o motivo) para a auditoria. Totais por pessoa e por tipo.
import { Download } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { type TipValeRelatorio, type TipValeType, getTipRelatorioVales } from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { type ColunaOpcional, SeletorColunas, useColunas } from "./colunas";
import { BarraFiltro, opcoesDe, useFiltro } from "./filtro";
import { NomePessoa, textoPessoa } from "./NomePessoa";
import { VALE_LABELS, baixarCsv, mesLocal, money, mutedStyle, panelStyle } from "./gorjetaUtils";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const valor = (v: TipValeRelatorio) => (v.type === "CREDITO" ? v.amount : -v.amount);
const EXT: Extratores<TipValeRelatorio> = {
  comp: (v) => v.periodo, data: (v) => v.date, nome: (v) => v.nome, tipo: (v) => VALE_LABELS[v.type], obs: (v) => v.notes,
  valor: (v) => valor(v), por: (v) => v.lancadoPor,
};
const COLUNAS: ColunaOpcional[] = [
  { chave: "comp", rotulo: "Apuração" }, { chave: "data", rotulo: "Data" }, { chave: "tipo", rotulo: "Tipo" },
  { chave: "obs", rotulo: "Descrição" }, { chave: "valor", rotulo: "Valor" }, { chave: "por", rotulo: "Lançado por" },
];
const totalTd: CSSProperties = { background: "var(--paper-soft, #f2f4f7)", fontWeight: 700, borderTop: "2px solid var(--line-strong, #c8d0da)" };

export function RelatorioVales({ onErro }: { onErro: (e: unknown) => void }) {
  const [de, setDe] = useState(mesLocal(2));
  const [ate, setAte] = useState(mesLocal());
  const [dados, setDados] = useState<TipValeRelatorio[] | null>(null);
  const ord = useOrdenacao("relatorio-vales");
  const filtro = useFiltro("relatorio-vales");
  const colunas = useColunas("relatorio-vales", ["comp", "por", "obs"]);
  const v = colunas.visivel;

  useEffect(() => {
    setDados(null);
    getTipRelatorioVales(de, ate).then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const todos = dados ?? [];
  const pessoas = useMemo(() => [...new Map((dados ?? []).map((x) => [x.employeeId, x])).values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")), [dados]);
  const listasFiltro = [
    { chave: "pessoa", rotulo: "Pessoa", opcoes: pessoas.map((p) => ({ valor: p.employeeId, rotulo: p.apelido ? `${p.nome} (${p.apelido})` : p.nome })) },
    { chave: "tipo", rotulo: "Tipo", opcoes: (Object.keys(VALE_LABELS) as TipValeType[]).map((t) => ({ valor: t, rotulo: VALE_LABELS[t] })) },
    { chave: "situacao", rotulo: "Situação", opcoes: [{ valor: "Ativo", rotulo: "Ativos" }, { valor: "Cancelado", rotulo: "Cancelados" }] },
    { chave: "apuracao", rotulo: "Apuração", opcoes: opcoesDe(todos, (x) => x.periodo) },
  ];
  const filtrados = filtro.aplicar(todos,
    (x) => [textoPessoa(x.nome, x.apelido), x.notes ?? "", VALE_LABELS[x.type], x.codigo ?? "", x.lancadoPor ?? "", x.periodo].join(" "),
    { pessoa: (x) => x.employeeId, tipo: (x) => x.type, situacao: (x) => (x.canceladoEm ? "Cancelado" : "Ativo"), apuracao: (x) => x.periodo });
  const linhas = aplicarOrdem(filtrados, ord.ordem, EXT);
  const ativos = filtrados.filter((x) => !x.canceladoEm);
  const saldo = ativos.reduce((a, x) => a + valor(x), 0);
  const porTipo = [...new Set(ativos.map((x) => x.type))].map((t) => ({ t, total: ativos.filter((x) => x.type === t).reduce((a, x) => a + x.amount, 0) }));
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "valor" ? "desc" : "asc") });
  // Linha de total: o rótulo ocupa as colunas até o Valor.
  const antesDoValor = 1 + ["comp", "data", "tipo", "obs"].filter(v).length;
  const rotuloTotal = (filtro.ativo ? `Total do filtro (${filtrados.length} de ${todos.length})` : "Total");

  function exportar() {
    baixarCsv(`gorjeta-vales-${de}-a-${ate}.csv`, [
      ["Competência", "Apuração", "Data", "Funcionário", "Apelido", "Tipo", "Descrição", "Valor", "Lançado por", "Situação", "Motivo do cancelamento"],
      ...linhas.map((x) => [x.competencia, x.periodo, dia(x.date), x.nome, x.apelido ?? "", VALE_LABELS[x.type], x.notes, valor(x), x.lancadoPor,
        x.canceladoEm ? `Cancelado por ${x.canceladoPor ?? "—"}` : "Ativo", x.motivoCancelamento]),
    ]);
  }

  return (
    <div style={panelStyle}>
      <div className="cabecalho-painel">
        <div className="cabecalho-painel-texto">
          <strong>Vales lançados</strong>
          <span>Adiantamentos e descontos abatidos da gorjeta, por competência. Cancelados continuam registrados, com o motivo.</span>
        </div>
        <div className="cabecalho-painel-acoes">
          <label className="barra-lista-campo">De <input type="month" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label className="barra-lista-campo">até <input type="month" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
          <SeletorColunas colunas={COLUNAS} ocultas={colunas.ocultas} alternar={colunas.alternar} mostrarTodas={colunas.mostrarTodas} />
          <Button variant="secondary" size="sm" leadingIcon={<Download size={14} />} onClick={exportar} disabled={linhas.length === 0}>Excel (CSV)</Button>
        </div>
      </div>
      <BarraFiltro filtro={filtro} listas={listasFiltro} total={todos.length} visiveis={filtrados.length}
        placeholder="Filtrar por nome, apelido, descrição…" />
      {porTipo.length > 0 && (
        <div className="grupo-cabecalho" style={{ position: "static" }}>
          {porTipo.map(({ t, total }) => (
            <span key={t} className="grupo-chip" style={{ color: t === "CREDITO" ? "var(--success)" : undefined }}>{VALE_LABELS[t]} {money(total)}</span>
          ))}
          <span className="grupo-chip grupo-chip-valor">Saldo {money(saldo)}</span>
        </div>
      )}
      {dados === null ? <span style={mutedStyle}>Carregando…</span> : linhas.length === 0 ? (
        <div className="estado-vazio"><strong>{todos.length === 0 ? "Nenhum vale nesse intervalo." : "Nenhum vale com esse filtro."}</strong></div>
      ) : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              {v("comp") && <ThOrdenavel {...th("comp")}>Apuração</ThOrdenavel>}
              {v("data") && <ThOrdenavel {...th("data")}>Data</ThOrdenavel>}
              <ThOrdenavel {...th("nome")} align="left" minWidth={180}>Funcionário</ThOrdenavel>
              {v("tipo") && <ThOrdenavel {...th("tipo")}>Tipo</ThOrdenavel>}
              {v("obs") && <ThOrdenavel {...th("obs")} minWidth={180}>Descrição</ThOrdenavel>}
              {v("valor") && <ThOrdenavel {...th("valor")}>Valor</ThOrdenavel>}
              {v("por") && <ThOrdenavel {...th("por")}>Lançado por</ThOrdenavel>}
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map((x) => (
              <Table.Row key={x.id} className={x.canceladoEm ? "linha-cancelada" : undefined}>
                {v("comp") && <Table.Td style={mutedStyle}>{x.periodo}</Table.Td>}
                {v("data") && <Table.Td>{dia(x.date)}</Table.Td>}
                <Table.Td>
                  <NomePessoa nome={x.nome} apelido={x.apelido} employeeId={x.employeeId}>
                    {/* Sem a coluna Descrição, o cancelamento aparece aqui para não sumir. */}
                    {x.canceladoEm && !v("obs") && <StatusBadge tone="neutral">Cancelado</StatusBadge>}
                  </NomePessoa>
                </Table.Td>
                {v("tipo") && <Table.Td>{VALE_LABELS[x.type]}</Table.Td>}
                {v("obs") && (
                  <Table.Td style={{ textAlign: "left" }}>
                    {x.notes ?? "—"}
                    {x.canceladoEm && <div style={mutedStyle}><StatusBadge tone="neutral">Cancelado</StatusBadge> {x.canceladoPor}: {x.motivoCancelamento}</div>}
                  </Table.Td>
                )}
                {v("valor") && <Table.Td style={{ fontWeight: 700, color: x.type === "CREDITO" ? "var(--success)" : "var(--danger)" }}>{money(valor(x))}</Table.Td>}
                {v("por") && <Table.Td style={mutedStyle}>{x.lancadoPor ?? "—"}</Table.Td>}
              </Table.Row>
            ))}
            <Table.Row>
              {v("valor") ? (
                <>
                  <Table.Td colSpan={antesDoValor} style={totalTd} title="Vales cancelados não entram no total">{rotuloTotal}</Table.Td>
                  <Table.Td style={{ ...totalTd, whiteSpace: "nowrap" }}>{money(saldo)}</Table.Td>
                  {v("por") && <Table.Td style={totalTd}> </Table.Td>}
                </>
              ) : (
                <Table.Td colSpan={antesDoValor + (v("por") ? 1 : 0)} style={totalTd} title="Vales cancelados não entram no total">{rotuloTotal}: {money(saldo)}</Table.Td>
              )}
            </Table.Row>
          </Table.Body>
        </Table>
      )}
    </div>
  );
}
