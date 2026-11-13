import { useState } from "react";
import { type Decimo13Linha, informarVariavelDecimo13, removerVariavelDecimo13 } from "../../api/client";
import { Button, TextField } from "../../design-system";
import { lerValorBr, NOMES_MESES } from "./variavel";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Props = { linha: Decimo13Linha; ano: number; podeEditar: boolean; aoMudar: () => Promise<void>; aoErro: (m: string) => void };

/** Variáveis de mês informadas à mão (gorjeta paga por fora etc.): substituem a apuração só no cálculo do 13º. */
export function VariavelInformada({ linha, ano, podeEditar, aoMudar, aoErro }: Props) {
  const [aberto, setAberto] = useState(false);
  const [mes, setMes] = useState(8);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const informadas = linha.informadas ?? [];

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
  const podeSalvar = numero != null && motivo.trim().length >= 5 && !busy;

  async function salvar() {
    if (numero == null) return;
    const ok = await executar(() => informarVariavelDecimo13({ year: ano, employeeId: linha.employeeId, mes, valor: numero, motivo: motivo.trim() }));
    if (!ok) return;
    setValor("");
    setMotivo("");
    setAberto(false);
  }

  return (
    <div className="folha-nota">
      {informadas.map((i) => (
        <div key={i.mes} title={i.motivo}>
          {NOMES_MESES[i.mes - 1]}: {brl(i.valor)} informado à mão
          {podeEditar && (
            <> <Button size="sm" variant="secondary" disabled={busy} onClick={() => void executar(() => removerVariavelDecimo13(ano, linha.employeeId, i.mes))}>Remover</Button></>
          )}
        </div>
      ))}
      {podeEditar && !aberto && (
        <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>Informar variável de um mês</Button>
      )}
      {podeEditar && aberto && (
        <div style={{ display: "grid", gap: 6, marginTop: 6, maxWidth: 320 }}>
          <label>
            Mês
            <select value={mes} onChange={(e) => setMes(Number(e.target.value))} style={{ marginLeft: 6 }}>
              {NOMES_MESES.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
          </label>
          <TextField value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Total do mês (gorjeta + extras), ex.: 638,16" aria-label="Valor da variável do mês" />
          <TextField value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (ex.: gorjeta paga por fora)" aria-label="Motivo" />
          <span>Só conta se o mês estiver dentro do período do 13º da pessoa. Se a 1ª parcela já foi paga, a diferença cai na 2ª.</span>
          <div className="form-actions">
            <Button variant="secondary" disabled={busy} onClick={() => setAberto(false)}>Cancelar</Button>
            <Button disabled={!podeSalvar} onClick={() => void salvar()}>Salvar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
