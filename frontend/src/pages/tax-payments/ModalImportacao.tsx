import { FileSpreadsheet, Upload } from "lucide-react";
import { Fragment, useRef, useState } from "react";
import { ApiError, confirmTaxImport, previewTaxImportXlsx, type TaxImportPreview } from "../../api/client";
import { Button, Money, Switch, Table } from "../../design-system";
import { Janela } from "../payables/Janela";
import "../payables/payables.css";
import "./tax-payments.css";

type Props = {
  onFechar: () => void;
  onImportado: (mensagem: string) => void;
};

type Erro = { mensagem: string; bloqueios: string[] };

const COLUNAS = "CNPJ, RAZÃO SOCIAL, NOME FANTASIA, ÓRGÃO / DOCUMENTO, DESCRIÇÃO, COMPETENCIA, VENCIMENTO, VALOR, DATA PAGAMENTO, COMENTÁRIOS";

// Passo 1: escolher a planilha. Passo 2: conferir o que vai entrar. Só então importa.
export function ModalImportacao({ onFechar, onImportado }: Props) {
  const [previa, setPrevia] = useState<TaxImportPreview | null>(null);
  const [lendo, setLendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [ignorarDuplicadas, setIgnorarDuplicadas] = useState(true);
  const [erro, setErro] = useState<Erro | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function ler(arquivo: File) {
    setLendo(true);
    setErro(null);
    try {
      setPrevia(await previewTaxImportXlsx(arquivo));
    } catch (e) {
      setErro({ mensagem: e instanceof Error ? e.message : "Não consegui ler a planilha.", bloqueios: [] });
    } finally {
      setLendo(false);
    }
  }

  async function importar() {
    if (!previa) return;
    setImportando(true);
    setErro(null);
    try {
      const r = await confirmTaxImport(previa.importFileId, ignorarDuplicadas);
      onImportado(`${r.imported} ${r.imported === 1 ? "guia importada" : "guias importadas"}${r.skipped ? ` (${r.skipped} ignoradas)` : ""}.`);
    } catch (e) {
      const bloqueios = e instanceof ApiError && Array.isArray(e.body?.bloqueios) ? (e.body.bloqueios as string[]) : [];
      setErro({ mensagem: e instanceof Error ? e.message : "Não foi possível importar.", bloqueios });
      setImportando(false);
    }
  }

  const aviso = erro && (
    <div className="field-hint field-hint--alerta" role="alert">
      <p style={{ margin: 0 }}>{erro.mensagem}</p>
      {erro.bloqueios.length > 0 && <ul className="ip-lista-simples">{erro.bloqueios.map((b) => <li key={b}>{b}</li>)}</ul>}
    </div>
  );

  if (!previa) {
    return (
      <Janela eyebrow="Impostos e guias" titulo="Importar planilha" onFechar={onFechar} ocupado={lendo} largura="media">
        <p className="ip-importa-texto">
          Planilha XLSX com as abas <b>Empresas</b> e <b>Impostos</b>. Colunas esperadas: {COLUNAS}.
          A <b>competência</b> é obrigatória (dd/mm/aaaa ou mm/aaaa): sem ela a guia não entra no DRE.
        </p>
        <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void ler(f); }} />
        <button type="button" className="ip-soltar" disabled={lendo} onClick={() => input.current?.click()}>
          <FileSpreadsheet size={28} aria-hidden="true" />
          <strong>{lendo ? "Lendo a planilha…" : "Escolher arquivo .xlsx"}</strong>
          <span>Você confere o que vai entrar antes de importar.</span>
        </button>
        {aviso}
      </Janela>
    );
  }

  const aImportar = ignorarDuplicadas ? previa.validRows - previa.duplicateRows : previa.validRows;
  const invalidas = previa.rows.filter((r) => !r.valid);
  const semRegra = Object.values(previa.categoriasPorTipo ?? {}).some((c) => c.includes(null));

  return (
    <Janela eyebrow="Impostos e guias" titulo="Conferir antes de importar" onFechar={onFechar} ocupado={importando} largura="media">
      <div className="ip-importa-cartoes">
        <Cartao rotulo="Linhas lidas" valor={previa.totalRows} />
        <Cartao rotulo="Prontas" valor={previa.validRows - previa.duplicateRows} tom="success" />
        <Cartao rotulo="Duplicadas" valor={previa.duplicateRows} tom="warning" />
        <Cartao rotulo="Com erro" valor={previa.invalidRows} tom="danger" />
      </div>
      <p className="ip-importa-sub">{previa.pendingRows} a pagar · {previa.paidRows} já pagas</p>

      {Object.keys(previa.byDocumentType).length > 0 && (
        <Table>
          <Table.Head>
            <Table.Row>
              <Table.Th>Tipo</Table.Th><Table.Th>Entra no DRE em</Table.Th><Table.Th align="right">Guias</Table.Th><Table.Th align="right">Total</Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {Object.entries(previa.byDocumentType).map(([tipo, info]) => (
              <Table.Row key={tipo}>
                <Table.Td><strong>{tipo}</strong></Table.Td>
                <Table.Td>
                  {(previa.categoriasPorTipo?.[tipo] ?? []).map((c, i) => (
                    <Fragment key={c ?? "sem"}>{i > 0 && " · "}{c ?? <span className="tax-sem-categoria">Sem categoria</span>}</Fragment>
                  ))}
                </Table.Td>
                <Table.Td align="right">{info.count}</Table.Td>
                <Table.Td align="right"><Money value={info.total} /></Table.Td>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}

      {semRegra && (
        <p className="field-hint field-hint--alerta">
          Guias sem categoria entram em "Não categorizadas" no DRE. Depois de importar, abra cada uma e escolha a categoria.
        </p>
      )}

      {invalidas.length > 0 && (
        <div className="ip-importa-erros">
          <strong>Linhas com erro (não serão importadas)</strong>
          <ul className="ip-lista-simples">
            {invalidas.slice(0, 50).map((r) => <li key={r.rowIndex}>Linha {r.rowIndex}: {r.errors.join("; ")}</li>)}
          </ul>
          {invalidas.length > 50 && <small>E mais {invalidas.length - 50} linhas.</small>}
        </div>
      )}

      {previa.duplicateRows > 0 && (
        <div className="ip-ja-paga">
          <Switch label="Ignorar duplicadas" checked={ignorarDuplicadas} onChange={setIgnorarDuplicadas} />
          <span>Ignorar as {previa.duplicateRows} duplicadas (já existem no sistema)</span>
        </div>
      )}

      {aviso}

      <div className="modal-actions">
        <Button variant="secondary" onClick={() => { setPrevia(null); setErro(null); }} disabled={importando}>Trocar arquivo</Button>
        <Button leadingIcon={<Upload size={15} />} onClick={() => void importar()} disabled={importando || aImportar <= 0}>
          {importando ? "Importando…" : `Importar ${aImportar} ${aImportar === 1 ? "guia" : "guias"}`}
        </Button>
      </div>
    </Janela>
  );
}

function Cartao({ rotulo, valor, tom = "neutral" }: { rotulo: string; valor: number; tom?: "neutral" | "success" | "warning" | "danger" }) {
  return (
    <div className={`ip-importa-cartao ip-importa-cartao--${tom}`}>
      <span className="ip-rotulo">{rotulo}</span>
      <strong>{valor}</strong>
    </div>
  );
}
