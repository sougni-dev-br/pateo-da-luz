// Folha salarial líquidos: a lista que vai para o pagamento no banco.
// CLT pelo líquido do extrato (ou pela regra do salário combinado); sem registro
// pelo total da apuração (salário ÷ 30 × dias + gorjeta − vales).
import { FileText, Pencil, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type TipFolhaLiquidos, type TipLinhaFolha, getTipFolhaLiquidos, salvarSalarioCombinado } from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { exportarFolhaLiquidos } from "./exportarPdf";
import { money, mutedStyle, numInputStyle, panelStyle } from "./gorjetaUtils";

type Props = {
  year: number;
  month: number;
  canEdit: boolean;
  /** OK dado à contabilidade: a folha está pronta para pagar. */
  liberada: boolean;
  /** Muda quando extratos ou etapas mudam: recarrega a folha. */
  versao: string;
  onNotice: (tone: "success" | "error" | "warning", message: string) => void;
};

const ORIGEM: Record<TipLinhaFolha["origem"], string> = {
  EXTRATO: "Extrato", SALARIO_COMBINADO: "Salário combinado", SEM_REGISTRO: "Sem registro",
};

export function FolhaLiquidos({ year, month, canEdit, liberada, versao, onNotice }: Props) {
  const [folha, setFolha] = useState<TipFolhaLiquidos | null>(null);
  const [editando, setEditando] = useState<{ employeeId: string; nome: string; valor: string; motivo: string } | null>(null);

  async function carregar() {
    try { setFolha(await getTipFolhaLiquidos(year, month)); } catch (e) { onNotice("error", (e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [year, month, versao]);

  async function salvarCombinado(valor: number | null) {
    if (!editando) return;
    try {
      await salvarSalarioCombinado(editando.employeeId, valor, valor == null ? null : editando.motivo.trim());
      setEditando(null);
      await carregar();
    } catch (e) { onNotice("error", (e as Error).message); }
  }

  if (!folha) return <div style={panelStyle}><span style={mutedStyle}>Carregando a folha…</span></div>;
  const grupos = [...new Set(folha.linhas.map((l) => l.grupo))];
  const combinadoDe = new Map(folha.salariosCombinados.map((c) => [c.employeeId, c]));

  return (
    <div style={panelStyle}>
      <div className="barra-lista">
        <strong>Folha salarial líquidos</strong>
        <span style={mutedStyle}>{folha.linhas.length} pessoas · total {money(folha.total)}</span>
        {!liberada && <StatusBadge tone="warning">Prévia — falta o OK à contabilidade</StatusBadge>}
        <div style={{ marginLeft: "auto" }}>
          <Button variant="secondary" leadingIcon={<FileText size={14} />} disabled={folha.linhas.length === 0}
            onClick={() => void exportarFolhaLiquidos(folha, liberada).catch((e) => onNotice("error", "Erro ao gerar o PDF: " + (e as Error).message))}>
            PDF da folha
          </Button>
        </div>
      </div>
      {folha.extratos.length === 0 && <span style={mutedStyle}>Sem extrato carregado: a lista só tem os sem registro.</span>}
      {editando && (
        <form className="combinado-form" onSubmit={(e) => { e.preventDefault(); void salvarCombinado(Number(editando.valor.replace(",", "."))); }}>
          <strong>Salário combinado de {editando.nome}</strong>
          <input style={{ ...numInputStyle, width: 110 }} type="number" step="0.01" min="0" value={editando.valor} aria-label="Salário combinado"
            onChange={(e) => setEditando({ ...editando, valor: e.target.value })} placeholder="R$" />
          <input value={editando.motivo} onChange={(e) => setEditando({ ...editando, motivo: e.target.value })} aria-label="Motivo do salário combinado"
            placeholder="Motivo (ex.: salário acertado acima do registrado)" style={{ flex: "1 1 240px" }} />
          <Button type="submit" disabled={!Number(editando.valor.replace(",", ".")) || editando.motivo.trim().length < 5}>Salvar</Button>
          {combinadoDe.has(editando.employeeId) && <Button type="button" variant="secondary" onClick={() => void salvarCombinado(null)}>Tirar</Button>}
          <button type="button" className="botao-desfazer" aria-label="Fechar" onClick={() => setEditando(null)}><X size={14} /></button>
          <span style={{ ...mutedStyle, flexBasis: "100%" }}>Na folha: (salário combinado − adiantamento salarial do extrato) + gorjeta líquida da apuração.</span>
        </form>
      )}
      <Table className="tabela-gorjeta">
        <Table.Head>
          <Table.Row>
            <Table.Th minWidth={220}>Funcionário</Table.Th>
            <Table.Th>Origem</Table.Th>
            <Table.Th minWidth={220}>Composição</Table.Th>
            <Table.Th>PIX</Table.Th>
            <Table.Th>Valor</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          {grupos.map((g) => {
            const doGrupo = folha.linhas.filter((l) => l.grupo === g);
            return [
              <Table.Row key={`g-${g}`} className="linha-grupo">
                <Table.Td colSpan={4} style={{ textAlign: "left", fontWeight: 700 }}>{g}</Table.Td>
                <Table.Td style={{ fontWeight: 700 }}>{money(doGrupo.reduce((a, l) => a + l.valor, 0))}</Table.Td>
              </Table.Row>,
              ...doGrupo.map((l) => (
                <Table.Row key={`${g}-${l.employeeId ?? l.nome}`}>
                  <Table.Td style={{ textAlign: "left" }}>
                    <div style={{ fontWeight: 500 }}>{l.nome}</div>
                    {l.aviso && <div style={{ ...mutedStyle, color: "var(--warning, #b45309)" }}>{l.aviso}</div>}
                    {canEdit && l.employeeId && l.origem !== "SEM_REGISTRO" && (
                      <button type="button" className="barra-lista-link" onClick={() => {
                        const c = combinadoDe.get(l.employeeId!);
                        setEditando({ employeeId: l.employeeId!, nome: l.nome, valor: c ? String(c.valor) : "", motivo: c?.motivo ?? "" });
                      }}>
                        <Pencil size={11} /> {combinadoDe.has(l.employeeId) ? "salário combinado" : "definir salário combinado"}
                      </button>
                    )}
                  </Table.Td>
                  <Table.Td><StatusBadge tone={l.origem === "SALARIO_COMBINADO" ? "info" : "neutral"}>{ORIGEM[l.origem]}</StatusBadge></Table.Td>
                  <Table.Td style={mutedStyle}>{l.composicao}</Table.Td>
                  <Table.Td style={mutedStyle}>{l.pix ?? <span style={{ color: "var(--warning, #b45309)" }}>sem PIX</span>}</Table.Td>
                  <Table.Td style={{ fontWeight: 700 }}>{money(l.valor)}</Table.Td>
                </Table.Row>
              )),
            ];
          })}
          <Table.Row>
            <Table.Td colSpan={4} style={{ textAlign: "left", fontWeight: 700 }}>Total a pagar</Table.Td>
            <Table.Td style={{ fontWeight: 800 }}>{money(folha.total)}</Table.Td>
          </Table.Row>
        </Table.Body>
      </Table>
    </div>
  );
}
