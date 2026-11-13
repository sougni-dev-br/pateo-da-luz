import { useMemo, useState } from "react";
import type { AnaliseConsumo, AnaliseConsumoMotivo } from "../../api/client";
import { Alert, Button, PanelEyebrow, StatusBadge, TextField } from "../../design-system";
import { Barra } from "./Barra";
import { percentual } from "./formato";
import { useFormato } from "./useFormato";

// Consumo teórico: o que deveria ter saído do estoque pelo que o PDV vendeu. É referência (não baixa o estoque) e
// só vale tanto quanto a cobertura: a faixa de cima diz quanto da receita o cálculo explica.

const COBERTURA_BOA = 0.8;
const COBERTURA_MINIMA = 0.5;
const LINHAS_INICIAIS = 50;

const SELO: Record<AnaliseConsumoMotivo, { texto: string; tom: "neutral" | "warning" }> = {
  SEM_VINCULO: { texto: "Sem vínculo", tom: "neutral" },
  PRATO_INDISPONIVEL: { texto: "Prato desativado", tom: "warning" },
  FICHA_SEM_ITENS: { texto: "Ficha sem ingredientes", tom: "warning" },
  FICHA_INCOMPLETA: { texto: "Ficha com ingrediente fora do cálculo", tom: "warning" },
  RENDIMENTO_NAO_E_PORCAO: { texto: "Ficha rende em peso ou volume", tom: "warning" },
  SEM_CONVERSAO: { texto: "Falta conversão de unidade", tom: "warning" }
};

const quantidade = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: n < 1 ? 3 : 2 });
const semAcento = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type Props = {
  dados: AnaliseConsumo;
  // Vincular acontece na aba Margem, que exige a permissão de custos: sem ela o atalho não aparece.
  onAbrirMargem?: () => void;
};

function Cobertura({ dados }: { dados: AnaliseConsumo }) {
  const { reais } = useFormato();
  const { pct, receitaTotal, receitaCoberta, receitaBuffet } = dados.cobertura;

  if (receitaTotal === 0) {
    return <Alert tone="info">Sem vendas por item neste período, então não há consumo para calcular.</Alert>;
  }
  const boa = pct >= COBERTURA_BOA;
  const parcial = !boa && pct >= COBERTURA_MINIMA;
  const titulo = boa ? "Boa cobertura" : parcial ? "Cobertura parcial" : "Ainda pouco confiável";
  const explicacao = boa
    ? "O consumo abaixo já explica a maior parte do que foi vendido."
    : parcial
      ? "Metade ou mais das vendas tem ficha ou vínculo. Use os números como piso: o consumo real é maior."
      : "Menos da metade das vendas tem ficha ou vínculo. Use os números como piso, não como total.";

  return (
    <section className="analise-stack" aria-labelledby="consumo-cobertura">
      <PanelEyebrow as="h2" id="consumo-cobertura">Quanto este cálculo explica</PanelEyebrow>
      <p>
        <strong>{percentual(pct, 0)}</strong> da receita vendida por item tem ficha ou vínculo ({reais(receitaCoberta)} de {reais(receitaTotal)}).
      </p>
      <div className="consumo-barra"><Barra razao={pct} tom={boa ? "neutro" : "perigo"} /></div>
      <p className="analise-nota"><strong>{titulo}.</strong> {explicacao}</p>
      {receitaBuffet > 0 && (
        <p className="analise-nota">O buffet ({reais(receitaBuffet)}) fica de fora: é vendido por pessoa, não por item.</p>
      )}
      <p className="analise-nota">É uma referência do que deveria ter saído. Não baixa o estoque nem muda o CMV.</p>
    </section>
  );
}

function Insumos({ dados }: { dados: AnaliseConsumo }) {
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState(false);
  const filtrados = useMemo(() => {
    const termo = semAcento(busca.trim());
    return termo ? dados.insumos.filter((i) => semAcento(i.insumo).includes(termo)) : dados.insumos;
  }, [dados.insumos, busca]);
  const visiveis = todos || busca ? filtrados : filtrados.slice(0, LINHAS_INICIAIS);

  return (
    <section className="analise-stack" aria-labelledby="consumo-insumos">
      <PanelEyebrow as="h2" id="consumo-insumos">Consumo previsto por insumo</PanelEyebrow>
      {dados.insumos.length === 0 ? (
        <p className="analise-nota">Nenhum insumo calculado: ainda não há produto vendido com ficha ou vínculo.</p>
      ) : (
        <>
          <TextField label="Buscar insumo" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Consumo previsto por insumo">
            <table className="mix">
              <caption className="sr-only">Quanto de cada insumo deveria ter saído do estoque no período, na unidade de estoque</caption>
              <thead>
                <tr>
                  <th scope="col">Insumo</th>
                  <th scope="col" className="direita">Previsto</th>
                  <th scope="col" className="direita">De pratos</th>
                  <th scope="col" className="direita">De revenda</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((i) => (
                  <tr key={i.insumoId}>
                    <th scope="row">{i.insumo}</th>
                    <td className="direita"><strong>{quantidade(i.consumo)}</strong> {i.unidade}</td>
                    <td className="direita">{i.consumoFichas > 0 ? quantidade(i.consumoFichas) : "—"}</td>
                    <td className="direita">{i.consumoRevenda > 0 ? quantidade(i.consumoRevenda) : "—"}</td>
                  </tr>
                ))}
                {visiveis.length === 0 && <tr><td colSpan={4}>Nenhum insumo com esse nome.</td></tr>}
              </tbody>
            </table>
          </div>
          {!todos && !busca && filtrados.length > LINHAS_INICIAIS && (
            <Button variant="secondary" size="sm" onClick={() => setTodos(true)}>Mostrar todos os {filtrados.length}</Button>
          )}
        </>
      )}
    </section>
  );
}

function SemCobertura({ dados, onAbrirMargem }: Props) {
  const { reais } = useFormato();
  const { semVinculo } = dados;
  const total = dados.cobertura.semVinculoTotal;
  return (
    <section className="analise-stack" aria-labelledby="consumo-sem-vinculo">
      <PanelEyebrow as="h2" id="consumo-sem-vinculo">O que vende e ainda não entra no cálculo</PanelEyebrow>
      {semVinculo.length === 0 ? (
        <p className="analise-nota">Todo produto vendido neste período já entra no cálculo.</p>
      ) : (
        <>
          <p className="analise-nota">
            {total > semVinculo.length ? `Mostrando os ${semVinculo.length} que mais vendem, de ${total}. ` : ""}
            A ordem é a do dinheiro: vincular o primeiro é o que mais aumenta a cobertura.
            {onAbrirMargem && (
              <>
                {" "}
                <Button variant="secondary" size="sm" onClick={onAbrirMargem}>Vincular na aba Margem</Button>
              </>
            )}
          </p>
          <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Produtos do PDV fora do cálculo de consumo">
            <table className="mix">
              <caption className="sr-only">Produtos do PDV que vendem e não entram no consumo teórico, do que mais vende ao que menos vende</caption>
              <thead>
                <tr>
                  <th scope="col">Produto no PDV</th>
                  <th scope="col" className="direita">Receita</th>
                  <th scope="col" className="direita">Vendidos</th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {semVinculo.map((p) => (
                  <tr key={p.codigo ?? p.nome}>
                    <th scope="row">{p.nome}</th>
                    <td className="direita">{reais(p.receita)}</td>
                    <td className="direita">{quantidade(p.quantidade)}</td>
                    <td><StatusBadge tone={SELO[p.motivo].tom}>{SELO[p.motivo].texto}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Problemas({ dados }: { dados: AnaliseConsumo }) {
  if (dados.problemas.length === 0) return null;
  return (
    <section className="analise-stack" aria-labelledby="consumo-problemas">
      <PanelEyebrow as="h2" id="consumo-problemas">Fichas para corrigir</PanelEyebrow>
      <p className="analise-nota">Estes itens ficaram de fora do consumo por um problema na ficha ou no vínculo. Corrigir aumenta o que o cálculo explica.</p>
      <ul className="analise-lista">
        {dados.problemas.map((p) => (
          <li key={`${p.tipo}|${p.origem}|${p.insumo ?? ""}`}>
            <strong>{p.origem}</strong>{p.insumo ? ` — ${p.insumo}` : ""}: {p.detalhe}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ConsumoPanel({ dados, onAbrirMargem }: Props) {
  return (
    <div className="analise-stack">
      <Cobertura dados={dados} />
      <Insumos dados={dados} />
      <SemCobertura dados={dados} onAbrirMargem={onAbrirMargem} />
      <Problemas dados={dados} />
    </div>
  );
}
