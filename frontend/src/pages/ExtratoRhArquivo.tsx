import { Banknote, CheckCircle2, FileUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ExtratoPreview, ImportExtratoResult, importExtratoRh, previewExtratoRh } from "../api/client";
import { avisosSoDaImportacao, confirmacaoImportar, resumoImportacao, textoBotaoImportar } from "./extratoRhTextos";
import { Alert, Button, FormGrid, Money, StatusBadge, SummaryCard, Table } from "../design-system";

const MONTHS = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function money(v: number | null) {
  if (v == null) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function lerComoBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

type Props = {
  arquivo: File;
  onImportado: () => void;
  onNotice: (tone: "success" | "error", message: string) => void;
};

// Um PDF do Retorno do RH: lê, mostra a prévia e lança — cada empresa no seu bloco.
export function ExtratoRhArquivo({ arquivo, onImportado, onNotice }: Props) {
  const [busy, setBusy] = useState(true);
  const [importing, setImporting] = useState(false);
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<ExtratoPreview | null>(null);
  const [erroLeitura, setErroLeitura] = useState("");
  const [result, setResult] = useState<ImportExtratoResult | null>(null);
  // Avisos que só a importação trouxe (a prévia é trocada logo depois de importar).
  const [avisosImportacao, setAvisosImportacao] = useState<string[]>([]);
  const montado = useRef(true);

  useEffect(() => {
    montado.current = true;
    void (async () => {
      try {
        const b64 = await lerComoBase64(arquivo);
        if (!montado.current) return;
        setBase64(b64);
        const p = await previewExtratoRh(b64);
        if (!montado.current) return;
        setPreview(p);
        onNotice("success", `${arquivo.name} lido: ${p.items.length} funcionário(s), ${p.matchedCount} casaram com o cadastro.`);
      } catch (e) {
        if (montado.current) setErroLeitura((e as Error).message);
      } finally {
        if (montado.current) setBusy(false);
      }
    })();
    return () => { montado.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arquivo]);

  async function handleImport() {
    if (!preview || !base64) return;
    if (!window.confirm(confirmacaoImportar(preview))) return;
    setImporting(true);
    try {
      const r = await importExtratoRh(base64, arquivo.name || "extrato.pdf");
      if (!montado.current) return;
      setResult(r);
      setAvisosImportacao(avisosSoDaImportacao(r, preview));
      onImportado();
      onNotice("success", resumoImportacao(r) + (r.funcionariosCadastrados > 0 ? ` ${r.funcionariosCadastrados} funcionário(s) cadastrado(s).` : ""));
      await refazerPrevia();
    } catch (e) {
      onNotice("error", (e as Error).message);
    } finally {
      if (montado.current) setImporting(false);
    }
  }

  // Depois de importar, a prévia antiga ainda diria "Lançar" como se nada existisse:
  // relê o mesmo arquivo para o botão e a confirmação passarem a "Atualizar". Se a
  // releitura falhar, some com a prévia (o resultado continua na tela).
  async function refazerPrevia() {
    try {
      const p = await previewExtratoRh(base64);
      if (montado.current) setPreview(p);
    } catch {
      if (montado.current) setPreview(null);
    }
  }

  const titulo = preview?.empresa || arquivo.name;
  return (
    <section aria-label={titulo} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>{preview?.empresa || "Lendo extrato…"}</strong>
        <span style={{ color: "var(--muted)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}><FileUp size={14} /> {arquivo.name}</span>
      </div>

      {busy && <span style={{ color: "var(--muted)", fontSize: 13 }}>Lendo…</span>}
      {erroLeitura && <Alert tone="error">{erroLeitura}</Alert>}

      {preview && (
        <>
          <FormGrid cols={4}>
            <SummaryCard compact label="Extrato" value={preview.calculo === "ADIANTAMENTO" ? "Adiantamento (dia 20)" : "Folha do mês"} tone={preview.calculo === "ADIANTAMENTO" ? "warning" : "neutral"} />
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
        </>
      )}

      {result && (
        <Alert tone="success">
          {resumoImportacao(result)} Total {result.totalLiquido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
          {result.funcionariosCadastrados > 0 ? ` · ${result.funcionariosCadastrados} funcionário(s) cadastrado(s) automaticamente` : ""}. Já aparecem na Folha de Pagamento / Contas a Pagar e no DRE (despesa de pessoal).
          {" "}{result.extratoAtualizado ? "Este arquivo já estava guardado: o registro foi completado, sem duplicar." : "O PDF e os holerites foram guardados."}
        </Alert>
      )}

      {result && avisosImportacao.length > 0 && (
        <Alert tone="warning" title={`${avisosImportacao.length} aviso(s) da importação`}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {avisosImportacao.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </Alert>
      )}
    </section>
  );
}
