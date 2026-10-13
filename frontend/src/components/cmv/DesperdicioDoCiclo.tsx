import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getDesperdicioDoCiclo, type DesperdicioDoCiclo as Dados } from "../../api/client";
import { Money } from "../../design-system";
import "./DesperdicioDoCiclo.css";

type Props = { periodoId: string };

const formatoPercentual = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

// Uma leitura, não uma conta: o desperdício já está dentro do CMV (inicial + compras − final),
// então aparece à parte da equação e nunca é somado nem subtraído dela.
export function DesperdicioDoCiclo({ periodoId }: Props) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(() => {
    let atual = true;
    setDados(null);
    setFalhou(false);
    getDesperdicioDoCiclo(periodoId)
      .then((resposta) => { if (atual) setDados(resposta); })
      .catch((erro) => {
        if (!atual) return;
        console.error("[cmv] não carregou o desperdício do ciclo:", erro instanceof Error ? erro.message : erro);
        setFalhou(true);
      });
    return () => { atual = false; };
  }, [periodoId]);

  useEffect(() => carregar(), [carregar]);

  // A apuração segue sem este bloco, mas a ausência não pode parecer "não houve desperdício".
  if (falhou) {
    return (
      <p className="cmv-desperdicio cmv-desperdicio--vazio" role="status">
        Não foi possível carregar o desperdício deste ciclo.{" "}
        <button type="button" className="cmv-desperdicio-retry" onClick={() => carregar()}>Tentar de novo</button>
      </p>
    );
  }
  if (!dados) return null;

  if (dados.total.lancamentos === 0) {
    return (
      <p className="cmv-desperdicio cmv-desperdicio--vazio">
        Nenhum desperdício registrado neste ciclo. <Link to="/estoque/desperdicio">Registrar</Link>
      </p>
    );
  }

  // Tudo sem custo: "R$ 0,00 de desperdício" diria que não houve perda, e houve.
  if (dados.total.semCusto === dados.total.lancamentos) {
    return (
      <section className="cmv-desperdicio" aria-label="Desperdício registrado no ciclo">
        <p>
          {dados.total.lancamentos} {dados.total.lancamentos === 1 ? "lançamento" : "lançamentos"} de desperdício neste ciclo, todos sem custo conhecido: não dá para dizer quanto representam em R$.
        </p>
        <small><Link to="/estoque/desperdicio">Ver detalhes</Link></small>
      </section>
    );
  }

  const principal = dados.porMotivo[0];
  return (
    <section className="cmv-desperdicio" aria-label="Desperdício registrado no ciclo">
      <p>
        Do consumo deste ciclo, <strong><Money value={dados.total.valor} /></strong>
        {dados.percentualDoCmv != null && <> ({formatoPercentual.format(dados.percentualDoCmv)}% do CMV)</>} foi desperdício registrado
        em {dados.total.lancamentos} {dados.total.lancamentos === 1 ? "lançamento" : "lançamentos"}
        {principal && principal.valor > 0 && <>, principalmente <strong>{principal.nome.toLowerCase()}</strong></>}.
      </p>
      <small>
        Já está dentro do CMV acima; não é somado a ele. Insumos valem ao último custo de compra conhecido e pratos prontos ao custo da ficha técnica
        {dados.total.semCusto > 0 && <> · {dados.total.semCusto} sem custo ficam de fora do valor</>}. Reflete os lançamentos de agora (mudam se algo for lançado ou cancelado depois). <Link to="/estoque/desperdicio">Ver detalhes</Link>
      </small>
    </section>
  );
}
