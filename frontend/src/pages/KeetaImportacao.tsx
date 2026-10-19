import { useRef, useState } from "react";
import {
  confirmKeetaImport,
  previewKeetaImport,
  type KeetaAcaoDoDia,
  type KeetaPrevisaoImportacao
} from "../api/client";
import { Alert, Card, Money, PanelEyebrow } from "../design-system";

const MUTED = "var(--color-text-muted, #6b7280)";

const ROTULO_DA_ACAO: Record<KeetaAcaoDoDia, string> = {
  CRIAR: "Novo",
  ALTERAR: "Altera",
  IGUAL: "Já está igual",
  CONFLITO: "Conflito"
};

const diaBr = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

function podeGravar(previsao: KeetaPrevisaoImportacao | null): boolean {
  if (!previsao || previsao.erros.length > 0) return false;
  return previsao.totais.criar + previsao.totais.alterar > 0;
}

export function KeetaImportacao({ onImportado }: { onImportado: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previsao, setPrevisao] = useState<KeetaPrevisaoImportacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravados, setGravados] = useState<number | null>(null);

  function limpar() {
    setArquivo(null);
    setPrevisao(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function conferir(file: File) {
    setArquivo(file);
    setPrevisao(null);
    setGravados(null);
    setErro(null);
    setOcupado(true);
    try {
      setPrevisao(await previewKeetaImport(file));
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Falha ao ler o arquivo.");
    } finally {
      setOcupado(false);
    }
  }

  async function gravar() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await confirmKeetaImport(arquivo);
      setGravados(resultado.gravados);
      limpar();
      onImportado();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar a importação.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card>
      <PanelEyebrow>Importar do portal</PanelEyebrow>
      <p style={{ fontSize: "13px", color: MUTED, margin: "8px 0 12px" }}>
        Envie o relatório "Dados do restaurante" da Keeta (Relatórios → Configuração de dados, .xlsx ou .csv, um
        dia por linha) com as colunas <b>Data</b>, <b>Vendas de itens</b>, <b>Despesa</b> (promoção paga pela
        loja), <b>Ganhos líquidos</b> e <b>Pedidos válidos</b>. A data é a de conclusão do pedido. Enviar o mesmo
        arquivo de novo não duplica nada.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.csv"
        aria-label="Arquivo do portal da Keeta"
        disabled={ocupado}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void conferir(f);
        }}
      />

      {erro && (
        <div style={{ marginTop: "12px" }}>
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
      {gravados !== null && (
        <div style={{ marginTop: "12px" }}>
          <Alert tone="success">{gravados} dia(s) gravado(s) no faturamento da Keeta.</Alert>
        </div>
      )}

      {previsao && (
        <div style={{ display: "grid", gap: "12px", marginTop: "12px" }}>
          {previsao.erros.length > 0 && (
            <Alert tone="error" title="O arquivo tem problemas — nada será gravado">
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {previsao.erros.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          {previsao.mesesTravados.length > 0 && (
            <Alert tone="warning" title="Fechamento travado">
              {previsao.mesesTravados.join(", ")}: os dias desses meses não serão gravados. Reabra o mês antes.
            </Alert>
          )}
          {previsao.totais.conflito > 0 && (
            <Alert tone="warning" title="Dias com mais de um lançamento ativo">
              {previsao.totais.conflito} dia(s) já têm 2 ou mais lançamentos da Keeta e não serão tocados. Resolva à mão.
            </Alert>
          )}
          <p style={{ margin: 0, fontSize: "14px" }}>
            <b>{previsao.totais.criar}</b> novos · <b>{previsao.totais.alterar}</b> alterados ·{" "}
            <b>{previsao.totais.igual}</b> iguais
          </p>
          <div style={{ overflowX: "auto", maxHeight: "260px" }}>
            <table style={{ width: "100%", fontSize: "13px", minWidth: "420px" }}>
              <thead>
                <tr style={{ textAlign: "left", color: MUTED }}>
                  <th>Dia</th>
                  <th>Situação</th>
                  <th style={{ textAlign: "right" }}>Pedidos</th>
                  <th style={{ textAlign: "right" }}>Bruto</th>
                  <th style={{ textAlign: "right" }}>Líquido</th>
                </tr>
              </thead>
              <tbody>
                {previsao.plano.map(({ dia, acao }) => (
                  <tr key={dia.date}>
                    <td>{diaBr(dia.date)}</td>
                    <td>{ROTULO_DA_ACAO[acao]}</td>
                    <td style={{ textAlign: "right" }}>{dia.orders}</td>
                    <td style={{ textAlign: "right" }}>
                      <Money value={dia.grossAmount} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Money value={dia.netAmount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="primary-button"
              type="button"
              disabled={ocupado || !podeGravar(previsao)}
              onClick={() => void gravar()}
            >
              Gravar no faturamento
            </button>
            <button className="secondary-button" type="button" disabled={ocupado} onClick={limpar}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
