import { useState } from "react";
import type { AnaliseMargemBebidas, AnaliseMargemBebidasAFazer, AnaliseUnidadeDeConsumo } from "../../api/client";
import { Button, Select, StatusBadge, TextField, type SelectOption } from "../../design-system";
import { lerQuantidade, percentual, semAcentoEmCaixaBaixa } from "./formato";
import { useFormato } from "./useFormato";

const UNIDADES: AnaliseUnidadeDeConsumo[] = ["UN", "ML", "L", "G", "KG"];
const MAX_QUANTIDADE = 100_000;
// O select nativo não tem busca: mostrar centenas de insumos por linha pesa no DOM e na rolagem.
const MAX_OPCOES_DO_RESTO = 50;

type Props = {
  itens: AnaliseMargemBebidasAFazer[];
  insumos: AnaliseMargemBebidas["insumosParaVincular"];
  insumosTruncados?: boolean;
  podeEditar: boolean;
  onVincular: (codigo: string, nome: string, insumoId: string, quantidade: number, unidade: AnaliseUnidadeDeConsumo) => Promise<void>;
};

// O que mais vende e ainda não tem margem. Cada venda consome uma quantidade do insumo comprado: 1 UN de uma lata,
// 150 ML de uma garrafa de 750 ML numa taça. Quantidade e unidade começam VAZIAS de propósito: um padrão de "1 UN" gravaria
// a garrafa inteira por taça sem ninguém perceber.
export function ListaBebidasAFazer({ itens, insumos, insumosTruncados = false, podeEditar, onVincular }: Props) {
  if (itens.length === 0) return <p className="analise-nota">Toda bebida vendida neste período já tem margem calculada.</p>;
  return (
    <>
      {insumosTruncados && podeEditar && (
        <p className="analise-nota">A lista de insumos passou do limite e foi cortada em ordem alfabética: se não achar o insumo, use a busca com parte do nome ou peça ajuste ao suporte.</p>
      )}
      <div className="mix-rolagem" tabIndex={0} role="region" aria-label="Bebidas do PDV sem margem calculada">
        <table className="mix">
          <caption className="sr-only">Bebidas do PDV que vendem e ainda não têm margem, da que mais vende à que menos vende</caption>
          <thead>
            <tr>
              <th scope="col">Bebida no PDV</th>
              <th scope="col" className="direita">Receita</th>
              <th scope="col">Situação</th>
              <th scope="col">O que fazer</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => (
              <LinhaBebida key={i.codigo ?? i.nome} item={i} insumos={insumos} podeEditar={podeEditar} onVincular={onVincular} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LinhaBebida({ item, insumos, podeEditar, onVincular }: Omit<Props, "itens" | "insumosTruncados"> & { item: AnaliseMargemBebidasAFazer }) {
  const { reais } = useFormato();
  const [busca, setBusca] = useState("");
  const [insumo, setInsumo] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [unidade, setUnidade] = useState<AnaliseUnidadeDeConsumo | "">("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const rotulo = (x: { nome: string; unidade: string }) => `${x.nome} (${x.unidade})`;
  const sugeridos = new Set(item.sugestoes.map((s) => s.insumoId));
  const termo = semAcentoEmCaixaBaixa(busca.trim());
  const doResto = insumos.filter((x) => !sugeridos.has(x.id) && (termo === "" || semAcentoEmCaixaBaixa(x.nome).includes(termo)));
  const mostrados = doResto.slice(0, MAX_OPCOES_DO_RESTO);
  // O insumo já escolhido nunca some da lista por causa da busca.
  const escolhido = insumos.find((x) => x.id === insumo);
  if (escolhido && !sugeridos.has(escolhido.id) && !mostrados.some((x) => x.id === escolhido.id)) mostrados.unshift(escolhido);
  const unidadeDoInsumo = new Map(insumos.map((x) => [x.id, x.unidade]));
  const opcoes: SelectOption[] = [
    ...item.sugestoes.map((s) => ({ value: s.insumoId, label: `${s.nome} (${unidadeDoInsumo.get(s.insumoId) ?? "UN"})`, group: "Parecidos com o nome" })),
    ...mostrados.map((x) => ({ value: x.id, label: rotulo(x), group: "Outros insumos com custo" }))
  ];

  async function vincular() {
    if (!item.codigo || salvando) return;
    if (!insumo || !unidade) {
      setErro("Escolha o insumo e a unidade do consumo.");
      return;
    }
    const n = lerQuantidade(quantidade);
    if (n === null || n <= 0) {
      setErro("Digite quanto uma venda consome, maior que zero (por exemplo 1 ou 150).");
      return;
    }
    if (n > MAX_QUANTIDADE) {
      setErro("Quantidade acima do limite aceito. Confira se não sobrou um zero.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onVincular(item.codigo, item.nome, insumo, n, unidade);
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
        <span className="venda-sub">{item.categoria ?? "sem categoria"} · {percentual(item.pctReceita, 1)} da receita das bebidas</span>
      </th>
      <td className="direita">{reais(item.receita)}</td>
      <td>
        <StatusBadge tone={item.situacao === "sem-vinculo" ? "neutral" : "warning"}>{item.situacao === "sem-vinculo" ? "Sem vínculo" : "Custo incompleto"}</StatusBadge>
      </td>
      <td>
        {item.situacao === "custo-incompleto" && (
          <p className="analise-nota">
            O insumo vinculado (<strong>{item.insumo}</strong>) não gera custo: {item.problema ?? "confira o custo e a unidade"} Ajuste o estoque ou refaça o vínculo abaixo.
          </p>
        )}
        {podeEditar && item.codigo ? (
          <div className="margem-vincular">
            <TextField
              label="Buscar insumo"
              aria-label={`Buscar insumo para ${item.nome}`}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoComplete="off"
              hint={doResto.length > MAX_OPCOES_DO_RESTO ? `Mostrando ${MAX_OPCOES_DO_RESTO} de ${doResto.length}: digite parte do nome.` : undefined}
              containerClassName="margem-select"
            />
            <Select
              label="Insumo"
              aria-label={`Insumo comprado para ${item.nome}`}
              value={insumo}
              options={opcoes}
              placeholder="Escolha o insumo"
              onChange={(e) => setInsumo(e.target.value)}
              containerClassName="margem-select"
            />
            <TextField
              label="Consumo por venda"
              aria-label={`Quanto uma venda de ${item.nome} consome`}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="ex.: 150"
              hint="por unidade vendida"
              containerClassName="margem-quantidade"
            />
            <Select
              label="Unidade"
              aria-label={`Unidade do consumo de ${item.nome}`}
              value={unidade}
              options={UNIDADES.map((u) => ({ value: u, label: u }))}
              placeholder="Unidade"
              onChange={(e) => setUnidade(e.target.value as AnaliseUnidadeDeConsumo)}
              containerClassName="margem-unidade"
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
          <span className="analise-nota">{item.codigo ? "Falta ligar esta bebida ao insumo comprado." : "Esta bebida não tem código no PDV e não dá para vincular."}</span>
        )}
      </td>
    </tr>
  );
}
