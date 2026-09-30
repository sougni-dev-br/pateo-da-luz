import { Banknote, CheckCircle2, FileUp, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ExtratoPreview, ImportExtratoResult, importExtratoRh, previewExtratoRh } from "../api/client";
import { confirmacaoImportar, resumoImportacao, textoBotaoImportar } from "./extratoRhTextos";
import { Notice, useNotice } from "../components/Notice";
import { Alert, Button, FormGrid, Money, StatusBadge, SummaryCard, Table } from "../design-system";
import { ExtratosGuardados } from "./ExtratosGuardados";

const MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function money(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ExtratoRh() {
  const { notice, setNotice } = useNotice();
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileName, setFileName] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<ExtratoPreview | null>(null);
  const [result, setResult] = useState<ImportExtratoResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Muda a cada importação: a lista de extratos guardados recarrega sozinha.
  const [importacoes, setImportacoes] = useState(0);
  const erroDaLista = useCallback((message: string) => setNotice({ tone: "error", message }), [setNotice]);

  async function handleFile(file: File) {
    setBusy(true);
    setFileName(file.name);
    setResult(null);
    try {
      const b64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
        reader.readAsDataURL(file);
      });
      setBase64(b64);
      const p = await previewExtratoRh(b64);
      setPreview(p);
      setNotice({ tone: "success", message: `Extrato lido: ${p.items.length} funcionário(s), ${p.matchedCount} casaram com o cadastro.` });
    } catch (e) {
      setPreview(null);
      setNotice({ tone: "error", message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    if (!preview || !base64) return;
    if (!window.confirm(confirmacaoImportar(preview))) return;
    setImporting(true);
    try {
      const r = await importExtratoRh(base64, fileName || "extrato.pdf");
      setResult(r);
      setImportacoes((n) => n + 1);
      setNotice({ tone: "success", message: resumoImportacao(r) + (r.funcionariosCadastrados > 0 ? ` ${r.funcionariosCadastrados} funcionário(s) cadastrado(s).` : "") });
    } catch (e) {
      setNotice({ tone: "error", message: (e as Error).message });
    } finally {
      setImporting(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Notice notice={notice} />

      <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <strong>Retorno do RH — Extrato Mensal</strong>
        <span style={{ color: "var(--muted)", fontSize: 13 }}>
          Suba o PDF do Extrato Mensal que o RH devolve. O sistema lê o holerite de cada funcionário, confere com o cadastro e, ao gerar os títulos no Contas a Pagar, guarda o PDF e os detalhes em "Extratos guardados".
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={busy} leadingIcon={<Upload size={14} />}>
            {busy ? "Lendo…" : "Selecionar PDF do extrato"}
          </Button>
          {fileName && <span style={{ color: "var(--muted)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}><FileUp size={14} /> {fileName}</span>}
        </div>
      </div>

      {preview && (
        <>
          <FormGrid cols={4}>
            <SummaryCard compact label="Extrato" value={preview.calculo === "ADIANTAMENTO" ? "Adiantamento (dia 20)" : "Folha do mês"} tone={preview.calculo === "ADIANTAMENTO" ? "warning" : "neutral"} />
            <SummaryCard compact label="Empresa" value={preview.empresa || "—"} />
            <SummaryCard compact label="Competência" value={`${MONTHS[preview.competenceMonth] ?? preview.competenceMonth}/${preview.competenceYear}`} />
            <SummaryCard compact label="Total líquido" moneyValue={preview.totalLiquido} tone="success" />
            <SummaryCard compact label="Casaram no cadastro" value={`${preview.matchedCount} de ${preview.items.length}`} tone={preview.matchedCount === preview.items.length ? "success" : "warning"} />
            <SummaryCard compact label="Holerites conferidos" value={`${preview.pessoasConferidas} de ${preview.pessoasLidas}`} tone={preview.pessoasConferidas === preview.pessoasLidas ? "success" : "warning"} />
          </FormGrid>

          {preview.avisos.length > 0 && (
            <Alert tone="warning" title={`${preview.avisos.length} aviso(s) do extrato — nada foi bloqueado`}>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {preview.avisos.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </Alert>
          )}

          {preview.matchedCount < preview.items.length && (
            <Alert tone="warning">
              {preview.items.length - preview.matchedCount} funcionário(s) do extrato não foram encontrados no cadastro (por CPF). Na etapa de geração, eles serão cadastrados automaticamente (nome + CPF + empresa).
            </Alert>
          )}

          <Table>
            <Table.Head>
              <Table.Row>
                <Table.Th minWidth={200}>Funcionário (extrato)</Table.Th>
                <Table.Th>CPF</Table.Th>
                <Table.Th>Gorjeta (lida)</Table.Th>
                <Table.Th>Líquido a pagar</Table.Th>
                <Table.Th>Cadastro</Table.Th>
              </Table.Row>
            </Table.Head>
            <Table.Body>
              {preview.items.map((i, idx) => (
                <Table.Row key={idx}>
                  <Table.Td style={{ fontWeight: 500 }}>{i.nome || "—"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{i.cpf}</Table.Td>
                  <Table.Td>{money(i.gorjeta)}</Table.Td>
                  <Table.Td style={{ fontWeight: 600 }}><Money value={i.liquido} /></Table.Td>
                  <Table.Td>
                    {i.matched
                      ? <StatusBadge tone="success"><CheckCircle2 size={12} /> {i.employeeName}{i.isActive === false ? " (desligado)" : ""}</StatusBadge>
                      : <StatusBadge tone="warning">Não encontrado</StatusBadge>}
                  </Table.Td>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Button onClick={() => void handleImport()} disabled={importing || busy} leadingIcon={<Banknote size={14} />}>
              {textoBotaoImportar(preview, importing)}
            </Button>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>
              {preview.calculo === "ADIANTAMENTO"
                ? "Lança o adiantamento do dia 20 de cada pessoa no Contas a Pagar, cadastra quem falta e guarda o PDF e os holerites."
                : "Lança o salário líquido de cada pessoa no Contas a Pagar (vence no dia 5 do mês seguinte), cadastra quem falta e guarda o PDF e os holerites."}
              {preview.lancamentosExistentes > 0 && " Quem já tem o lançamento deste extrato é atualizado, sem duplicar."}
            </span>
          </div>

          {result && (
            <Alert tone="success">
              {resumoImportacao(result)} Total {result.totalLiquido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              {result.funcionariosCadastrados > 0 ? ` · ${result.funcionariosCadastrados} funcionário(s) cadastrado(s) automaticamente` : ""}. Já aparecem na Folha de Pagamento / Contas a Pagar e no DRE (despesa de pessoal).
              {" "}{result.extratoAtualizado ? "Este arquivo já estava guardado: o registro foi completado, sem duplicar." : "O PDF e os holerites foram guardados."}
            </Alert>
          )}
        </>
      )}

      <ExtratosGuardados recarregar={importacoes} onErro={erroDaLista} />
    </div>
  );
}
