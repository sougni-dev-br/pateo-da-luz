import type { AnaliseCardapio } from "../../api/client";
import { Alert, KpiCard, PanelEyebrow } from "../../design-system";
import { AlertaSemVenda } from "./AlertaSemVenda";
import { AvisoHoje } from "./AvisoHoje";
import { CurvaAbc } from "./CurvaAbc";
import { InsightCard } from "./InsightCard";
import { MixDeCategorias } from "./MixDeCategorias";
import { SimulacoesDoCardapio } from "./SimulacoesDoCardapio";
import { TabelaAbc } from "./TabelaAbc";
import { VendaPorComanda } from "./VendaPorComanda";
import { inteiro, intervalo, percentual } from "./formato";
import { useFormato } from "./useFormato";
import "./visao.css";

export function CardapioPanel({ dados }: { dados: AnaliseCardapio }) {
  const { reais } = useFormato();
  const { resumo, cauda } = dados;

  if (resumo.produtosVendidos === 0) {
    return (
      <div className="analise-stack">
        <AvisoHoje ativo={dados.hojeFicouDeFora} />
        <AlertaSemVenda dados={dados}>
          Ainda não há item vendido neste período. O agente do PDV precisa estar atualizado e o período precisa ser reimportado para o histórico
          aparecer aqui.
        </AlertaSemVenda>
      </div>
    );
  }

  const comparar = dados.categorias.some((c) => c.variacaoPontos !== null);

  return (
    <div className="analise-stack">
      <p className="analise-contexto">
        <strong>{intervalo(dados.periodo)}</strong> · receita dos itens vendidos <strong>{reais(resumo.faturamentoItens)}</strong> em{" "}
        {inteiro(dados.cobertura.comandas)} comandas com pessoas informadas. Pouca venda <strong>não é motivo, sozinha, para cortar</strong> um produto.
      </p>
      <AvisoHoje ativo={dados.hojeFicouDeFora} />

      <div className="analise-kpis analise-kpis-quatro">
        <KpiCard label="Produtos vendidos" value={inteiro(resumo.produtosVendidos)} sub={`${inteiro(resumo.produtosClasseA)} fazem 80% da receita`} />
        <KpiCard
          label="Cauda longa"
          value={inteiro(resumo.produtosCaudaLonga)}
          sub={`produtos vendem menos de ${percentual(cauda.limite, 1)} cada e somam ${percentual(resumo.participacaoCauda, 1)} da receita`}
        />
        <KpiCard
          label="Maior dependência"
          value={resumo.maiorProduto ? percentual(resumo.maiorProduto.participacao, 0) : "—"}
          sub={resumo.maiorProduto ? `da receita vem de ${resumo.maiorProduto.produto}` : "sem vendas"}
          tone={resumo.maiorProduto && resumo.maiorProduto.participacao >= 0.4 ? "warning" : "neutral"}
        />
        <KpiCard
          label="Vendido a R$ 0"
          value={inteiro(resumo.semPrecoProdutos)}
          sub={resumo.semPrecoProdutos > 0 ? `${resumo.semPrecoProdutos === 1 ? "produto" : "produtos"}, ${inteiro(resumo.semPrecoUnidades)} unidades sem valor lançado` : "nenhum produto sem valor"}
          tone={resumo.semPrecoProdutos > 0 ? "danger" : "neutral"}
        />
      </div>

      <section aria-labelledby="cardapio-prioridades">
        <PanelEyebrow as="h2" id="cardapio-prioridades">Prioridades: o que o cardápio mostra</PanelEyebrow>
        {dados.insights.length === 0 ? (
          <p className="analise-nota">Nada fora do normal no cardápio neste período.</p>
        ) : (
          <ul className="insights">
            {dados.insights.map((i) => (
              <InsightCard key={i.id} insight={i} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="cardapio-mix">
        <PanelEyebrow as="h2" id="cardapio-mix">O que vendemos: receita por categoria</PanelEyebrow>
        <MixDeCategorias linhas={dados.categorias} comparar={comparar} />
      </section>

      <section aria-labelledby="cardapio-comanda">
        <PanelEyebrow as="h2" id="cardapio-comanda">O que cada comanda leva</PanelEyebrow>
        <VendaPorComanda attach={dados.attach} />
        <PanelEyebrow className="subsecao">E se mais comandas levassem o item?</PanelEyebrow>
        <SimulacoesDoCardapio simulacoes={dados.simulacoes} />
      </section>

      <section aria-labelledby="cardapio-abc">
        <PanelEyebrow as="h2" id="cardapio-abc">Curva ABC: poucos produtos sustentam a receita</PanelEyebrow>
        <p className="analise-nota">A curva mede só receita: água e café ficam na classe C por custarem pouco, não por serem dispensáveis. Veja margem e papel do item antes de qualquer corte.</p>
        <CurvaAbc abc={dados.abc} totalProdutos={resumo.produtosVendidos} />
        <TabelaAbc itens={dados.abc.itens} legenda={`Os ${dados.abc.itens.length} produtos que mais vendem, com a classe da curva ABC`} />
      </section>

      <section aria-labelledby="cardapio-detalhe">
        <PanelEyebrow as="h2" id="cardapio-detalhe">Detalhe</PanelEyebrow>
        {cauda.produtos > 0 && (
          <details className="detalhe">
            <summary>
              Cauda longa: {inteiro(cauda.produtos)} {cauda.produtos === 1 ? "produto abaixo" : "produtos abaixo"} de {percentual(cauda.limite, 1)} da receita
            </summary>
            <p className="analise-nota">
              Os {inteiro(cauda.exemplos.length)} que mais vendem entre eles. Revise a permanência, não o corte automático: vinho, prato de ocasião e
              item sazonal costumam estar aqui.
            </p>
            <TabelaAbc itens={cauda.exemplos} legenda="Produtos da cauda longa" />
          </details>
        )}
        {dados.semPreco.length > 0 && (
          <details className="detalhe">
            <summary>Vendido a R$ 0: {inteiro(dados.semPreco.length)} {dados.semPreco.length === 1 ? "produto" : "produtos"}</summary>
            <p className="analise-nota">Confira se é cortesia ou promoção de propósito, ou se o preço não está cadastrado no PDV.</p>
            <ul className="lista-simples">
              {dados.semPreco.map((s) => (
                <li key={s.produto}>
                  <strong>{s.produto}</strong> ({s.categoria}): {inteiro(s.unidades)} unidades
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
