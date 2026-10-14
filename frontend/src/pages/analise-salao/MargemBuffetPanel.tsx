import { useEffect, useRef, useState } from "react";
import type { AnaliseMargemBuffet } from "../../api/client";
import { Button, KpiCard, PanelEyebrow } from "../../design-system";
import { EditorDeCustoDoBuffet } from "./EditorDeCustoDoBuffet";
import { InsightCard } from "./InsightCard";
import { inteiro, nomeDoMes, percentual } from "./formato";
import { useFormato } from "./useFormato";
import "./visao.css";

// Mesmo corte do aviso do servidor: faixa com menos pessoas que isso (staff, teste de preço) não vira alerta.
const MIN_PESSOAS_FAIXA_PARA_AVISO = 50;

type Props = {
  dados: AnaliseMargemBuffet;
  podeEditar: boolean;
  // valor null apaga o custo do mês. Quem chama recarrega o relatório depois.
  onSalvarCusto: (ano: number, mes: number, valor: number | null) => Promise<void>;
};

// Buffet por pessoa: o PDV dá pessoas e ticket; o custo de comida por pessoa é informado por mês (não existe ficha do buffet).
export function MargemBuffetPanel({ dados, podeEditar, onSalvarCusto }: Props) {
  const { reais, reaisCentavos } = useFormato();
  const [editando, setEditando] = useState<{ ano: number; mes: number } | null>(null);
  // Ao desistir do editor, o foco volta ao botão do mês (o formulário some e o foco iria para o <body>).
  const voltarFocoA = useRef<string | null>(null);
  useEffect(() => {
    if (editando !== null || voltarFocoA.current === null) return;
    document.getElementById(voltarFocoA.current)?.focus();
    voltarFocoA.current = null;
  }, [editando]);
  const idDoBotao = (ano: number, mes: number) => `custo-buffet-${ano}-${mes}`;
  const { buffet, faixas, meses, margem, cobertura, referencia } = dados;

  if (buffet.comandas === 0) {
    return <p className="analise-nota">Nenhum buffet vendido neste período.</p>;
  }

  const emEdicao = editando ? meses.find((m) => m.ano === editando.ano && m.mes === editando.mes) : undefined;

  return (
    <div className="analise-stack">
      <p className="analise-contexto">
        O PDV informa <strong>quantas pessoas comeram e quanto cada uma pagou</strong>. O <strong>custo de comida por pessoa não existe no sistema</strong> (o buffet não tem ficha): informe o custo médio de cada mês
        e a margem é calculada só onde ele foi informado. O ticket é calculado sobre as comandas com o número de pessoas preenchido.
      </p>

      <div className="analise-kpis analise-kpis-quatro">
        <KpiCard label="Pessoas no buffet" value={inteiro(buffet.pessoas)} sub={`${inteiro(buffet.comandas)} comandas · ${percentual(buffet.pctDaReceita, 0)} da receita do salão`} />
        <KpiCard label="Ticket por pessoa" value={reaisCentavos(buffet.receitaPorPessoa)} sub={`${reais(buffet.receita)} de buffet no período`} />
        <KpiCard
          label="Custo por pessoa"
          value={margem ? reaisCentavos(margem.custoPorPessoa) : "—"}
          sub={margem ? `média dos meses informados · ${percentual(cobertura.pctComCusto, 0)} das pessoas` : "não informado"}
          tone={margem && cobertura.pctComCusto < 1 ? "warning" : "neutral"}
        />
        <KpiCard
          label="Margem por pessoa"
          value={margem ? reaisCentavos(margem.margemPorPessoa) : "—"}
          sub={margem ? `${reais(margem.margem)}${margem.margemPct === null ? "" : ` · ${percentual(margem.margemPct, 0)} do ticket`}` : "informe o custo para calcular"}
          tone={margem && margem.margemPorPessoa < 0 ? "danger" : "neutral"}
        />
      </div>

      {dados.insights.length > 0 && (
        <section aria-labelledby="buffet-prioridades">
          <PanelEyebrow as="h2" id="buffet-prioridades">Prioridades: o que o buffet mostra</PanelEyebrow>
          <ul className="insights">
            {dados.insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="buffet-meses">
        <PanelEyebrow as="h2" id="buffet-meses">Custo e margem por mês</PanelEyebrow>
        <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Tabela do buffet por mês">
          <table className="mix">
            <caption className="sr-only">Pessoas, ticket, custo informado e margem do buffet em cada mês</caption>
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col" className="direita">Pessoas</th>
                <th scope="col" className="direita">Ticket por pessoa</th>
                <th scope="col" className="direita">Custo por pessoa</th>
                <th scope="col" className="direita">Margem por pessoa</th>
                <th scope="col" className="direita">Margem total</th>
                {podeEditar && <th scope="col">Custo</th>}
              </tr>
            </thead>
            <tbody>
              {meses.map((m) => {
                const negativa = m.margemPorPessoa !== null && m.margemPorPessoa < 0;
                const semPessoas = m.status === "sem-pessoas";
                return (
                  <tr key={`${m.ano}-${m.mes}`}>
                    <th scope="row">{nomeDoMes(m.mes, m.ano)}</th>
                    <td className="direita">{semPessoas ? "—" : inteiro(m.pessoas)}</td>
                    <td className="direita">{semPessoas ? "—" : reaisCentavos(m.receitaPorPessoa)}</td>
                    <td className="direita">{m.custoPorPessoa === null ? <span className="venda-sub">não informado</span> : reaisCentavos(m.custoPorPessoa)}</td>
                    <td className={`direita ${negativa ? "variacao-ruim" : ""}`}>
                      {m.margemPorPessoa === null ? "—" : (
                        <>
                          <strong>{reaisCentavos(m.margemPorPessoa)}</strong>
                          {m.margemPct !== null && <span className="venda-sub">{negativa ? "abaixo do custo · " : ""}{percentual(m.margemPct, 0)} do ticket</span>}
                        </>
                      )}
                    </td>
                    <td className={`direita ${negativa ? "variacao-ruim" : ""}`}>{m.margemTotal === null ? "—" : <strong>{reais(m.margemTotal)}</strong>}</td>
                    {podeEditar && (
                      <td>
                        {semPessoas ? (
                          <span className="venda-sub">sem pessoas nas comandas</span>
                        ) : (
                          <button type="button" id={idDoBotao(m.ano, m.mes)} className="insight-link" onClick={() => setEditando({ ano: m.ano, mes: m.mes })} aria-label={`${m.custoPorPessoa === null ? "Informar" : "Alterar"} o custo por pessoa de ${nomeDoMes(m.mes, m.ano)}`}>
                            {m.custoPorPessoa === null ? "informar custo" : "alterar"}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!podeEditar && cobertura.mesesSemCusto > 0 && <p className="analise-nota">Quem pode editar a análise informa o custo dos meses que faltam.</p>}
        {podeEditar && editando && emEdicao && (
          <EditorDeCustoDoBuffet
            key={`${editando.ano}-${editando.mes}`}
            ano={editando.ano}
            mes={editando.mes}
            atual={emEdicao.custoPorPessoa}
            referencia={referencia}
            onSalvar={(valor) => onSalvarCusto(editando.ano, editando.mes, valor)}
            onFechar={() => setEditando(null)}
            onCancelar={() => {
              voltarFocoA.current = idDoBotao(editando.ano, editando.mes);
              setEditando(null);
            }}
          />
        )}
        {podeEditar && !editando && cobertura.mesesSemCusto > 0 && (
          <p className="analise-nota">
            {cobertura.mesesSemCusto === 1 ? "1 mês sem custo informado." : `${cobertura.mesesSemCusto} meses sem custo informado.`}{" "}
            <Button variant="secondary" size="sm" onClick={() => {
              const primeiro = meses.find((m) => m.status === "sem-custo");
              if (primeiro) setEditando({ ano: primeiro.ano, mes: primeiro.mes });
            }}>
              Informar o primeiro
            </Button>
          </p>
        )}
      </section>

      <section aria-labelledby="buffet-faixas">
        <PanelEyebrow as="h2" id="buffet-faixas">Por faixa de preço</PanelEyebrow>
        <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Tabela do buffet por faixa de preço">
          <table className="mix">
            <caption className="sr-only">Pessoas e ticket do buffet em cada faixa de preço, da que mais vende à que menos vende</caption>
            <thead>
              <tr>
                <th scope="col">Faixa</th>
                <th scope="col" className="direita">Pessoas</th>
                <th scope="col" className="direita">Ticket por pessoa</th>
                <th scope="col" className="direita">Receita</th>
                <th scope="col" className="direita">Do buffet</th>
              </tr>
            </thead>
            <tbody>
              {faixas.map((f) => {
                const abaixo = margem !== null && f.pessoas >= MIN_PESSOAS_FAIXA_PARA_AVISO && f.receitaPorPessoa < margem.custoPorPessoa;
                return (
                  <tr key={f.produto}>
                    <th scope="row">{f.produto}</th>
                    <td className="direita">{inteiro(f.pessoas)}</td>
                    <td className={`direita ${abaixo ? "variacao-ruim" : ""}`}>
                      {f.pessoas > 0 ? reaisCentavos(f.receitaPorPessoa) : "—"}
                      {abaixo && <span className="venda-sub">abaixo do custo médio</span>}
                    </td>
                    <td className="direita">{reais(f.receita)}</td>
                    <td className="direita">{percentual(f.pctReceita, 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
