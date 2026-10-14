import { useState } from "react";
import { Link } from "react-router-dom";
import type { AnaliseMargemAFazer, AnaliseMargem } from "../../api/client";
import { Button, Select, StatusBadge, type SelectOption } from "../../design-system";
import { percentual } from "./formato";
import { useFormato } from "./useFormato";

type Props = {
  itens: AnaliseMargemAFazer[];
  // Total de pendências: a lista traz só as que mais vendem.
  total?: number;
  pratos: AnaliseMargem["pratosParaVincular"];
  podeEditar: boolean;
  onVincular: (codigo: string, nome: string, pratoId: string) => Promise<void>;
};

const SELO: Record<AnaliseMargemAFazer["situacao"], { texto: string; tom: "neutral" | "warning" | "danger" }> = {
  "sem-vinculo": { texto: "Sem vínculo", tom: "neutral" },
  "prato-indisponivel": { texto: "Prato desativado", tom: "warning" },
  "sem-ficha": { texto: "Ficha sem ingredientes", tom: "warning" },
  "custo-incompleto": { texto: "Custo incompleto", tom: "warning" }
};

// O que mais vende e ainda não tem margem: a ordem é a do dinheiro, então a primeira linha é o melhor
// próximo passo para a equipe.
export function ListaAFazer({ itens, total, pratos, podeEditar, onVincular }: Props) {
  if (itens.length === 0) return <p className="analise-nota">Todo prato vendido neste período já tem margem calculada.</p>;
  return (
    <>
    {total !== undefined && total > itens.length && <p className="analise-nota">Mostrando os {itens.length} que mais vendem, de {total} pendentes.</p>}
    <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Produtos do PDV sem margem calculada">
      <table className="mix">
        <caption className="sr-only">Produtos do PDV que vendem e ainda não têm margem, do que mais vende ao que menos vende</caption>
        <thead>
          <tr>
            <th scope="col">Produto no PDV</th>
            <th scope="col" className="direita">Receita</th>
            <th scope="col">Situação</th>
            <th scope="col">O que fazer</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <LinhaAFazer key={i.codigo ?? i.nome} item={i} pratos={pratos} podeEditar={podeEditar} onVincular={onVincular} />
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function LinhaAFazer({ item, pratos, podeEditar, onVincular }: Omit<Props, "itens" | "total"> & { item: AnaliseMargemAFazer }) {
  const { reais } = useFormato();
  const [escolhido, setEscolhido] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const selo = SELO[item.situacao];

  const sugeridos = new Set(item.sugestoes.map((s) => s.pratoId));
  const opcoes: SelectOption[] = [
    ...item.sugestoes.map((s) => ({ value: s.pratoId, label: s.nome, group: "Parecidos com o nome" })),
    ...pratos.filter((p) => !sugeridos.has(p.id)).map((p) => ({ value: p.id, label: p.nome, group: "Todos os pratos do salão" }))
  ];

  async function vincular() {
    if (!escolhido || !item.codigo || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      await onVincular(item.codigo, item.nome, escolhido);
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : "Não foi possível vincular.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <tr>
      <th scope="row">
        {item.nome}
        <span className="venda-sub">{item.categoria ?? "sem categoria"} · {percentual(item.pctReceita, 1)} da receita dos pratos</span>
      </th>
      <td className="direita">{reais(item.receita)}</td>
      <td>
        <StatusBadge tone={selo.tom}>{selo.texto}</StatusBadge>
      </td>
      <td>
        {item.situacao === "sem-vinculo" || item.situacao === "prato-indisponivel" ? (
          podeEditar && item.codigo ? (
            <div className="margem-vincular">
              {item.situacao === "prato-indisponivel" && (
                <p className="analise-nota">O prato ligado a este produto foi desativado ou saiu do cardápio do salão. Escolha outro.</p>
              )}
              <Select
                label={`Prato da ficha para ${item.nome}`}
                value={escolhido}
                options={opcoes}
                placeholder="Escolha o prato"
                onChange={(e) => setEscolhido(e.target.value)}
                containerClassName="margem-select"
              />
              <Button size="sm" onClick={() => void vincular()} aria-busy={salvando} aria-label={`Vincular ${item.nome}`}>
                {salvando ? "Vinculando…" : "Vincular"}
              </Button>
              {erro && (
                <p className="meta-erro" role="alert">
                  {erro}
                </p>
              )}
            </div>
          ) : (
            <span className="analise-nota">{item.codigo ? "Falta ligar este produto a um prato da ficha técnica do salão." : "Este produto não tem código no PDV e não dá para vincular."}</span>
          )
        ) : (
          <span className="analise-nota">
            {item.situacao === "sem-ficha" ? <>A ficha do salão de <strong>{item.prato}</strong> não tem ingredientes. </> : <>A ficha de <strong>{item.prato}</strong> tem ingrediente sem custo ou sem conversão de unidade. </>}
            <Link to="/cardapio/fichas-tecnicas" aria-label={`Abrir fichas técnicas para ${item.prato}`}>Abrir fichas técnicas</Link>
          </span>
        )}
      </td>
    </tr>
  );
}
