// Folha salarial líquidos: a lista que vai para o pagamento no banco.
// CLT pelo líquido do extrato (ou pela regra do salário combinado); sem registro
// pelo total da apuração (salário ÷ 30 × dias + gorjeta − vales).
// O salário combinado se cadastra em Funcionários; aqui só aparece o efeito.
import { AlertTriangle, FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { type TipFolhaLiquidos, type TipLinhaFolha, getTipFolhaLiquidos } from "../../api/client";
import { Button, StatusBadge, Table } from "../../design-system";
import { exportarFolhaLiquidos } from "./exportarPdf";
import { money, mutedStyle, panelStyle } from "./gorjetaUtils";

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

export function FolhaLiquidos({ year, month, liberada, versao, onNotice }: Props) {
  const [folha, setFolha] = useState<TipFolhaLiquidos | null>(null);

  async function carregar() {
    try { setFolha(await getTipFolhaLiquidos(year, month)); } catch (e) { onNotice("error", (e as Error).message); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void carregar(); }, [year, month, versao]);

  if (!folha) return <div style={panelStyle}><span style={mutedStyle}>Carregando a folha…</span></div>;
  const grupos = [...new Set(folha.linhas.map((l) => l.grupo))];

  return (
    <div style={panelStyle}>
      <div className="cabecalho-painel">
        <div className="cabecalho-painel-texto">
          <strong>Folha salarial líquidos {!liberada && <StatusBadge tone="warning">Prévia — falta o OK à contabilidade</StatusBadge>}</strong>
          <span>{folha.linhas.length} pessoas · total {money(folha.total)} · CLT pelo extrato, sem registro pela apuração</span>
        </div>
        <div className="cabecalho-painel-acoes">
          <Button variant="secondary" size="sm" leadingIcon={<FileText size={14} />} disabled={folha.linhas.length === 0}
            onClick={() => void exportarFolhaLiquidos(folha, liberada).catch((e) => onNotice("error", "Erro ao gerar o PDF: " + (e as Error).message))}>
            PDF da folha
          </Button>
        </div>
      </div>
      {folha.extratos.length === 0 && <span style={mutedStyle}>Sem extrato carregado: a lista só tem os sem registro.</span>}
      {folha.linhas.some((l) => l.origem === "SALARIO_COMBINADO") && (
        <span style={mutedStyle}>Salário combinado: definido na ficha do funcionário (Funcionários → seção Trabalho).</span>
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
                    {l.aviso && (
                      <div style={{ ...mutedStyle, color: "var(--warning, #b45309)", display: "flex", gap: 4, alignItems: "center" }}>
                        <AlertTriangle size={12} aria-hidden /> {l.aviso}
                      </div>
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
