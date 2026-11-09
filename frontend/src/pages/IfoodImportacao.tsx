import { useRef, useState } from "react";
import {
  confirmIfoodImport,
  previewIfoodImport,
  type IfoodAcaoDaLinha,
  type IfoodPrevisaoImportacao
} from "../api/client";
import { Alert, Card, Money, PanelEyebrow } from "../design-system";

const MUTED = "var(--color-text-muted, #6b7280)";

const ROTULO_DA_ACAO: Record<IfoodAcaoDaLinha, string> = {
  CRIAR: "Novo",
  ALTERAR: "Altera",
  IGUAL: "Já está igual",
  CONFLITO: "Conflito"
};

const mesBr = (competencia: string) => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

type ItemDoPlano = IfoodPrevisaoImportacao["plano"][number];

/** O que de fato acontece com a linha: loja sem cadastro e mês travado não são gravados, seja qual for a ação. */
function situacaoEfetiva(item: ItemDoPlano, mesesTravados: string[]): string {
  if (!item.nomeDaLoja) return "Loja não cadastrada";
  if (mesesTravados.includes(item.loja.competencia) && item.acao !== "IGUAL") return "Mês travado";
  return ROTULO_DA_ACAO[item.acao];
}

function podeGravar(previsao: IfoodPrevisaoImportacao | null, confirmouAlertas: boolean): boolean {
  if (!previsao || previsao.erros.length > 0) return false;
  if (previsao.alertas.length > 0 && !confirmouAlertas) return false;
  return previsao.totais.criar + previsao.totais.alterar > 0 || previsao.plano.some((i) => i.nomeDaLoja && i.repassesNovos > 0);
}

export function IfoodImportacao({ onImportado }: { onImportado: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previsao, setPrevisao] = useState<IfoodPrevisaoImportacao | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmouAlertas, setConfirmouAlertas] = useState(false);
  const [resultado, setResultado] = useState<{ linhas: number; repasses: number; gravadas: string[] } | null>(null);

  function limpar() {
    setArquivo(null);
    setPrevisao(null);
    setConfirmouAlertas(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function conferir(file: File) {
    setArquivo(file);
    setPrevisao(null);
    setConfirmouAlertas(false);
    setResultado(null);
    setErro(null);
    setOcupado(true);
    try {
      setPrevisao(await previewIfoodImport(file));
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
      const r = await confirmIfoodImport(arquivo, confirmouAlertas);
      setResultado({ linhas: r.gravados, repasses: r.repassesGravados, gravadas: r.gravadas });
      limpar();
      onImportado();
    } catch (e: unknown) {
      setErro(
        (e instanceof Error ? e.message : "Falha ao gravar a importação.") +
          " Se a tela de cima mostrar valores diferentes do esperado, a gravação pode ter sido concluída: confira antes de enviar de novo."
      );
      // A resposta pode ter se perdido depois do commit (timeout): recarrega para a tela mostrar o que de fato está gravado.
      onImportado();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card>
      <PanelEyebrow>Importar do portal</PanelEyebrow>
      <p style={{ fontSize: "13px", color: MUTED, margin: "8px 0 12px" }}>
        No portal do iFood, abra a loja → <b>Financeiro</b>, escolha o mês e clique em <b>Exportar</b> (Relatório de
        Conciliação, só .xlsx, até 5 MB). O relatório é de uma loja e um mês: envie um arquivo por vez. Enviar o
        mesmo arquivo de novo não duplica nada, e um mês exportado antes de fechar atualiza o parcial. O saldo
        devedor de períodos anteriores fica fora do líquido.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        aria-label="Relatório de Conciliação do portal do iFood"
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
      {resultado && (
        <div style={{ marginTop: "12px" }}>
          <Alert tone="success">
            {resultado.linhas} linha(s) mensal(is) gravada(s) e {resultado.repasses} repasse(s) semanal(is) novo(s)
            {resultado.gravadas.length > 0 ? `: ${resultado.gravadas.join(", ")}` : "."}
          </Alert>
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
          {previsao.alertas.length > 0 && (
            <Alert tone="warning" title="Atenção: confira antes de gravar">
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {previsao.alertas.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <label style={{ display: "flex", gap: "8px", alignItems: "flex-start", marginTop: "10px" }}>
                <input
                  type="checkbox"
                  checked={confirmouAlertas}
                  disabled={ocupado}
                  onChange={(e) => setConfirmouAlertas(e.target.checked)}
                />
                <span>Li os alertas e conferi os valores com o portal. Quero gravar mesmo assim.</span>
              </label>
            </Alert>
          )}
          {previsao.avisos.length > 0 && (
            <Alert tone="info" title="Informações">
              <ul style={{ margin: 0, paddingLeft: "18px" }}>
                {previsao.avisos.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          )}
          {previsao.mesesTravados.length > 0 && (
            <Alert tone="warning" title="Fechamento travado">
              {previsao.mesesTravados.join(", ")}: esses meses não serão gravados. Reabra o mês antes.
            </Alert>
          )}
          {previsao.totais.conflito > 0 && (
            <Alert tone="warning" title="Conflito com lançamento existente">
              {previsao.totais.conflito} loja(s)-mês em conflito não serão tocadas. Veja os alertas acima e resolva à mão.
            </Alert>
          )}
          <p style={{ margin: 0, fontSize: "14px" }}>
            <b>{previsao.totais.criar}</b> novos · <b>{previsao.totais.alterar}</b> alterados ·{" "}
            <b>{previsao.totais.igual}</b> iguais
            {previsao.totais.semLoja + previsao.totais.travado + previsao.totais.conflito > 0 && (
              <>
                {" "}· <b>{previsao.totais.semLoja + previsao.totais.travado + previsao.totais.conflito}</b> não serão
                gravados
              </>
            )}
          </p>
          {previsao.plano.length === 0 && previsao.erros.length === 0 && (
            <Alert tone="warning">O arquivo não tem nenhum lançamento de venda para importar.</Alert>
          )}
          <div style={{ overflowX: "auto", maxHeight: "260px" }}>
            <table style={{ width: "100%", fontSize: "13px", minWidth: "720px" }}>
              <thead>
                <tr style={{ textAlign: "left", color: MUTED }}>
                  <th>Loja</th>
                  <th>Mês</th>
                  <th>Situação</th>
                  <th style={{ textAlign: "right" }}>Pedidos</th>
                  <th style={{ textAlign: "right" }}>Bruto</th>
                  <th style={{ textAlign: "right" }}>Líquido</th>
                  <th style={{ textAlign: "right" }}>Repasses novos</th>
                </tr>
              </thead>
              <tbody>
                {previsao.plano.map((item) => (
                  <tr key={`${item.loja.competencia}-${item.loja.lojaIdCurto}`}>
                    <td>{item.nomeDaLoja ?? `Loja ${item.loja.lojaIdCurto}`}</td>
                    <td>{mesBr(item.loja.competencia)}</td>
                    <td>{situacaoEfetiva(item, previsao.mesesTravados)}</td>
                    <td style={{ textAlign: "right" }}>
                      {item.anterior && item.anterior.pedidos !== item.loja.pedidos && (
                        <span style={{ color: MUTED }}>{item.anterior.pedidos} → </span>
                      )}
                      {item.loja.pedidos}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {item.anterior && (
                        <span style={{ color: MUTED }}>
                          <Money value={item.anterior.bruto} /> →{" "}
                        </span>
                      )}
                      <Money value={item.loja.bruto} />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {item.anterior && (
                        <span style={{ color: MUTED }}>
                          <Money value={item.anterior.liquido} /> →{" "}
                        </span>
                      )}
                      <Money value={item.loja.liquido} />
                    </td>
                    <td style={{ textAlign: "right" }}>{item.repassesNovos}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              className="primary-button"
              type="button"
              disabled={ocupado || !podeGravar(previsao, confirmouAlertas)}
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
