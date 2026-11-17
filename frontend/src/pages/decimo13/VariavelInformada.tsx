import { useState } from "react";
import { type Decimo13Linha, informarVariavelDecimo13, removerVariavelDecimo13 } from "../../api/client";
import { Button, TextField } from "../../design-system";
import { agruparMesesFaltando, lerValorBr, NOMES_MESES } from "./variavel";

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const nomeDoMes = (mes: number) => NOMES_MESES[mes - 1];
const abreviado = (mes: number) => nomeDoMes(mes).slice(0, 3);

type Props = { linha: Decimo13Linha; ano: number; podeEditar: boolean; aoMudar: () => Promise<void>; aoErro: (m: string) => void };

/**
 * Variáveis do mês (gorjeta + extras) da pessoa no 13º. Uma linha por situação: o que falta (botões pequenos, um por mês),
 * o que já foi informado à mão (recolhido) e o que ainda está em andamento. O valor informado substitui a apuração só no 13º.
 */
export function VariavelInformada({ linha, ano, podeEditar, aoMudar, aoErro }: Props) {
  const [mes, setMes] = useState<number | null>(null);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const informadas = linha.informadas ?? [];
  const grupos = agruparMesesFaltando(linha.mesesFaltando ?? []);
  const totalInformado = informadas.reduce((s, i) => s + i.valor, 0);

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

  function faltando(rotulo: string, dica: string, meses: number[]) {
    if (meses.length === 0) return null;
    return (
      <div className="var13-linha" title={dica}>
        <span className="var13-rotulo">{rotulo}</span>
        {meses.map((m) => podeEditar ? (
          <button key={m} type="button" className="var13-mes" aria-pressed={mes === m} disabled={busy} onClick={() => abrir(m)} aria-label={`Informar valor de ${nomeDoMes(m)}`}>
            {abreviado(m)}
          </button>
        ) : <span key={m}>{abreviado(m)}</span>)}
      </div>
    );
  }

  const nada = informadas.length === 0 && grupos.semApuracao.length === 0 && grupos.semLancamento.length === 0 && grupos.emAndamento.length === 0;

  return (
    <div className="var13">
      {faltando("Sem apuração:", "Meses sem apuração de gorjeta no sistema: ficam fora da média. Se a pessoa recebeu variável neles, clique no mês e informe o valor.", grupos.semApuracao)}
      {faltando("Sem valor:", "Meses apurados em que a pessoa não aparece: contam como R$ 0,00 na média. Se ela recebeu por fora, clique no mês e informe o valor.", grupos.semLancamento)}
      {informadas.length > 0 && (
        <details>
          <summary>{informadas.length === 1 ? "1 mês informado à mão" : `${informadas.length} meses informados à mão`} · {brl(totalInformado)}</summary>
          <ul className="var13-lista">
            {informadas.map((i) => (
              <li key={i.mes} title={i.motivo}>
                <span>{nomeDoMes(i.mes)}</span>
                <span className="num">{brl(i.valor)}</span>
                <span>{podeEditar && <button type="button" className="var13-remover" disabled={busy} aria-label={`Remover ${nomeDoMes(i.mes)}`} onClick={() => void executar(() => removerVariavelDecimo13(ano, linha.employeeId, i.mes))}>remover</button>}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {grupos.emAndamento.length > 0 && <div>Em andamento: {grupos.emAndamento.map(nomeDoMes).join(", ")} (entra na média quando a gorjeta fechar)</div>}
      {podeEditar && mes != null && (
        <div className="var13-form">
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
      {nada && <div>Variáveis de todos os meses do período já estão na apuração.</div>}
    </div>
  );
}
