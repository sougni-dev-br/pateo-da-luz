// Relatório de vales: todos os lançamentos de um intervalo de competências,
// com os cancelados (e o motivo) para a auditoria. Totais por pessoa e por tipo.
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type TipValeRelatorio, type TipValeType, getTipRelatorioVales } from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { VALE_LABELS, baixarCsv, mesLocal, money, mutedStyle, panelStyle } from "./gorjetaUtils";
import { type Extratores, ThOrdenavel, aplicarOrdem, useOrdenacao } from "./ordenacao";

const dia = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
const valor = (v: TipValeRelatorio) => (v.type === "CREDITO" ? v.amount : -v.amount);
const EXT: Extratores<TipValeRelatorio> = {
  comp: (v) => v.periodo, data: (v) => v.date, nome: (v) => v.nome, tipo: (v) => VALE_LABELS[v.type], valor: (v) => valor(v),
};

export function RelatorioVales({ onErro }: { onErro: (e: unknown) => void }) {
  const [de, setDe] = useState(mesLocal(2));
  const [ate, setAte] = useState(mesLocal());
  const [dados, setDados] = useState<TipValeRelatorio[] | null>(null);
  const [pessoa, setPessoa] = useState("");
  const [tipo, setTipo] = useState<"" | TipValeType>("");
  const [verCancelados, setVerCancelados] = useState(false);
  const ord = useOrdenacao("rel-vales");

  useEffect(() => {
    setDados(null);
    getTipRelatorioVales(de, ate).then(setDados).catch(onErro);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [de, ate]);

  const pessoas = useMemo(() => [...new Map((dados ?? []).map((v) => [v.employeeId, v.nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR")), [dados]);
  const filtrados = (dados ?? []).filter((v) => (verCancelados || !v.canceladoEm) && (!pessoa || v.employeeId === pessoa) && (!tipo || v.type === tipo));
  const linhas = aplicarOrdem(filtrados, ord.ordem, EXT);
  const ativos = filtrados.filter((v) => !v.canceladoEm);
  const porTipo = [...new Set(ativos.map((v) => v.type))].map((t) => ({ t, total: ativos.filter((v) => v.type === t).reduce((a, v) => a + v.amount, 0) }));
  const th = (c: string) => ({ coluna: c, ordem: ord.ordem, onOrdenar: () => ord.alternar(c, c === "valor" ? "desc" : "asc") });

  function exportar() {
    baixarCsv(`gorjeta-vales-${de}-a-${ate}.csv`, [
      ["Competência", "Apuração", "Data", "Funcionário", "Tipo", "Descrição", "Valor", "Lançado por", "Situação", "Motivo do cancelamento"],
      ...linhas.map((v) => [v.competencia, v.periodo, dia(v.date), v.nome, VALE_LABELS[v.type], v.notes, valor(v), v.lancadoPor,
        v.canceladoEm ? `Cancelado por ${v.canceladoPor ?? "—"}` : "Ativo", v.motivoCancelamento]),
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
          <Button variant="secondary" size="sm" leadingIcon={<Download size={14} />} onClick={exportar} disabled={linhas.length === 0}>Excel (CSV)</Button>
        </div>
      </div>
      <div className="barra-lista">
        <label className="barra-lista-campo">Pessoa
          <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="">Todas</option>
            {pessoas.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
        </label>
        <label className="barra-lista-campo">Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as "" | TipValeType)}>
            <option value="">Todos</option>
            {(Object.keys(VALE_LABELS) as TipValeType[]).map((t) => <option key={t} value={t}>{VALE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="barra-lista-campo"><input type="checkbox" checked={verCancelados} onChange={(e) => setVerCancelados(e.target.checked)} /> Mostrar cancelados</label>
      </div>
      {porTipo.length > 0 && (
        <div className="grupo-cabecalho" style={{ position: "static" }}>
          {porTipo.map(({ t, total }) => (
            <span key={t} className="grupo-chip" style={{ color: t === "CREDITO" ? "var(--success)" : undefined }}>{VALE_LABELS[t]} {money(total)}</span>
          ))}
          <span className="grupo-chip grupo-chip-valor">Saldo {money(ativos.reduce((a, v) => a + valor(v), 0))}</span>
        </div>
      )}
      {dados === null ? <span style={mutedStyle}>Carregando…</span> : linhas.length === 0 ? (
        <div className="estado-vazio"><strong>Nenhum vale nesse intervalo.</strong></div>
      ) : (
        <Table className="tabela-gorjeta">
          <Table.Head>
            <Table.Row>
              <ThOrdenavel {...th("comp")}>Apuração</ThOrdenavel>
              <ThOrdenavel {...th("data")}>Data</ThOrdenavel>
              <ThOrdenavel {...th("nome")} align="left" minWidth={180}>Funcionário</ThOrdenavel>
              <ThOrdenavel {...th("tipo")}>Tipo</ThOrdenavel>
              <Table.Th minWidth={180}>Descrição</Table.Th>
              <ThOrdenavel {...th("valor")}>Valor</ThOrdenavel>
              <Table.Th>Lançado por</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {linhas.map((v) => (
              <Table.Row key={v.id} className={v.canceladoEm ? "linha-cancelada" : undefined}>
                <Table.Td style={mutedStyle}>{v.periodo}</Table.Td>
                <Table.Td>{dia(v.date)}</Table.Td>
                <Table.Td style={{ fontWeight: 500 }}>{v.nome}</Table.Td>
                <Table.Td>{VALE_LABELS[v.type]}</Table.Td>
                <Table.Td style={{ textAlign: "left" }}>
                  {v.notes ?? "—"}
                  {v.canceladoEm && <div style={mutedStyle}><StatusBadge tone="neutral">Cancelado</StatusBadge> {v.canceladoPor}: {v.motivoCancelamento}</div>}
                </Table.Td>
                <Table.Td style={{ fontWeight: 700, color: v.type === "CREDITO" ? "var(--success)" : "var(--danger)" }}>{money(valor(v))}</Table.Td>
                <Table.Td style={mutedStyle}>{v.lancadoPor ?? "—"}</Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </div>
  );
}
