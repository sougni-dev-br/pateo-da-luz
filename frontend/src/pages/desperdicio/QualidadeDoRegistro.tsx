import { CheckCircle2, CircleAlert } from "lucide-react";
import type { WasteAnalysis } from "../../api/client";

type Verificacao = { id: string; ok: boolean; texto: string };

function verificacoes(analise: WasteAnalysis, veCusto: boolean): Verificacao[] {
  const { qualidade: q, total } = analise;
  const lista: Verificacao[] = [];
  if (q.diasSemRegistro != null && q.diasComVenda != null && q.diasComVenda > 0) {
    lista.push({
      id: "dias",
      ok: q.diasSemRegistro === 0,
      texto: q.diasSemRegistro === 0
        ? `Todos os ${q.diasComVenda} dias com venda têm registro.`
        : `${q.diasSemRegistro} de ${q.diasComVenda} dias com venda sem nenhum registro.`,
    });
  }
  if (veCusto) {
    lista.push({ id: "custo", ok: q.semCusto === 0, texto: q.semCusto === 0 ? "Todos os lançamentos têm custo." : `${q.semCusto} ${q.semCusto === 1 ? "lançamento sem custo" : "lançamentos sem custo"} (fora do valor).` });
  }
  lista.push({ id: "outro", ok: q.motivoOutro === 0, texto: q.motivoOutro === 0 ? 'Nenhum lançamento como "Outro".' : `${q.motivoOutro} como "Outro" (motivo vago).` });
  lista.push({ id: "retro", ok: q.retroativos === 0, texto: q.retroativos === 0 ? "Tudo lançado no próprio dia ou no seguinte." : `${q.retroativos} digitados mais de um dia depois.` });
  if (veCusto) {
    lista.push({ id: "foto", ok: q.semFotoNosMaiores === 0, texto: q.semFotoNosMaiores === 0 ? "Os maiores lançamentos têm foto." : `${q.semFotoNosMaiores} dos 10 maiores sem foto.` });
  }
  // Sem lançamentos não há o que conferir.
  return total.lancamentos === 0 ? [] : lista;
}

type Props = { analise: WasteAnalysis; veCusto: boolean };

/** Quanto confiar nos números: o que falta no registro, e quem está registrando. */
export function QualidadeDoRegistro({ analise, veCusto }: Props) {
  const itens = verificacoes(analise, veCusto);
  if (itens.length === 0) return null;
  const pendentes = itens.filter((i) => !i.ok).length;
  return (
    <section className="waste-card" aria-labelledby="waste-qualidade-titulo">
      <h3 id="waste-qualidade-titulo">Confiança do registro</h3>
      <p className="waste-note">{pendentes === 0 ? "Os números do período estão completos." : `${pendentes} ${pendentes === 1 ? "ponto afeta" : "pontos afetam"} a confiança dos números.`}</p>
      <ul className="waste-checks">
        {itens.map((i) => (
          <li key={i.id} className={i.ok ? "waste-check waste-check--ok" : "waste-check waste-check--atencao"}>
            {i.ok ? <CheckCircle2 size={16} aria-hidden /> : <CircleAlert size={16} aria-hidden />}
            <span><span className="waste-sr">{i.ok ? "Ok: " : "Atenção: "}</span>{i.texto}</span>
          </li>
        ))}
      </ul>
      {analise.porPessoa.length > 0 && (
        <p className="waste-note">
          Quem registrou: {analise.porPessoa.slice(0, 5).map((p) => `${p.nome} (${p.lancamentos})`).join(", ")}
          {analise.porPessoa.length > 5 ? ` e mais ${analise.porPessoa.length - 5}` : ""}.
        </p>
      )}
    </section>
  );
}
