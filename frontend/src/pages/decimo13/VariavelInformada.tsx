import { useState } from "react";
import { type Decimo13Linha, informarVariavelDecimo13, removerVariavelDecimo13 } from "../../api/client";
import { Button, TextField } from "../../design-system";
import { agruparMesesFaltando, lerValorBr, NOMES_MESES } from "./variavel";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nomeDoMes = (mes: number) => NOMES_MESES[mes - 1];

type Props = { linha: Decimo13Linha; ano: number; podeEditar: boolean; aoMudar: () => Promise<void>; aoErro: (m: string) => void };

/**
 * Variáveis do mês (gorjeta + extras) da pessoa: mostra quais meses do período dela estão sem valor e deixa informar o valor
 * de cada um. O valor informado substitui a apuração só no cálculo do 13º.
 */
export function VariavelInformada({ linha, ano, podeEditar, aoMudar, aoErro }: Props) {
  const [mes, setMes] = useState<number | null>(null);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const informadas = linha.informadas ?? [];
  const grupos = agruparMesesFaltando(linha.mesesFaltando ?? []);

  // Devolve true só se deu certo: o formulário não fecha nem perde o digitado quando falha.
  async function executar(acao: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await acao();
      await aoMudar();
      return true;
    } catch (e) {
      aoErro(e instanceof Error ? e.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const numero = lerValorBr(valor);
  const podeSalvar = mes != null && numero != null && motivo.trim().length >= 5 && !busy;

  function abrir(m: number) {
    setMes(m);
    setValor("");
    setMotivo("");
  }

  async function salvar() {
    if (mes == null || numero == null) return;
    const ok = await executar(() => informarVariavelDecimo13({ year: ano, employeeId: linha.employeeId, mes, valor: numero, motivo: motivo.trim() }));
    if (!ok) return;
    setValor("");
    setMotivo("");
    setMes(null);
  }

  function chips(meses: number[]) {
    return meses.map((m) => (
      <Button key={m} size="sm" variant={mes === m ? "primary" : "secondary"} disabled={busy} onClick={() => abrir(m)} aria-label={`Informar valor de ${nomeDoMes(m)}`}>
        {nomeDoMes(m).slice(0, 3)}
      </Button>
    ));
  }

  return (
    <div className="folha-nota">
      {informadas.map((i) => (
        <div key={i.mes} title={i.motivo}>
          {nomeDoMes(i.mes)}: {brl(i.valor)} informado à mão
          {podeEditar && (
            <> <Button size="sm" variant="secondary" disabled={busy} onClick={() => void executar(() => removerVariavelDecimo13(ano, linha.employeeId, i.mes))}>Remover</Button></>
          )}
        </div>
      ))}
      {grupos.semApuracao.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <strong>Sem apuração de gorjeta no sistema</strong> — ficam fora da média; se a pessoa recebeu variável nesses meses, informe o valor:
          {podeEditar ? <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>{chips(grupos.semApuracao)}</div> : <> {grupos.semApuracao.map(nomeDoMes).join(", ")}</>}
        </div>
      )}
      {grupos.semLancamento.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <strong>Apurado, mas a pessoa não aparece</strong> — contam como R$ 0,00 na média; se recebeu por fora, informe o valor:
          {podeEditar ? <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 2 }}>{chips(grupos.semLancamento)}</div> : <> {grupos.semLancamento.map(nomeDoMes).join(", ")}</>}
        </div>
      )}
      {grupos.emAndamento.length > 0 && (
        <div style={{ marginTop: 4 }}>Em andamento ({grupos.emAndamento.map(nomeDoMes).join(", ")}): entra na média quando a gorjeta do mês for fechada.</div>
      )}
      {podeEditar && mes != null && (
        <div style={{ display: "grid", gap: 6, marginTop: 6, maxWidth: 320 }}>
          <strong>Variável de {nomeDoMes(mes)}</strong>
          <TextField value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Total do mês (gorjeta + extras), ex.: 638,16" aria-label={`Valor da variável de ${nomeDoMes(mes)}`} />
          <TextField value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ex.: gorjeta paga por fora)" aria-label="Motivo" />
          <span>Se a 1ª parcela já foi paga, a diferença cai na 2ª.</span>
          <div className="form-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setMes(null)}>Cancelar</Button>
            <Button disabled={!podeSalvar} onClick={() => void salvar()}>Salvar</Button>
          </div>
        </div>
      )}
      {podeEditar && mes == null && informadas.length + grupos.semApuracao.length + grupos.semLancamento.length === 0 && grupos.emAndamento.length === 0 && (
        <span>Variáveis de todos os meses do período já estão na apuração.</span>
      )}
    </div>
  );
}
