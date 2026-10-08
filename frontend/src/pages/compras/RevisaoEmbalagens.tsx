import { Loader2, PackageCheck, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ProdutoDaRevisaoDeEmbalagem, aplicarEmbalagens, getRevisaoDeEmbalagens } from "../../api/client";
import { Money } from "../../design-system";
import { formatDate } from "../../utils/format";
import "./revisao-embalagens.css";

const EMBALAGENS = ["PCT", "CX", "FD", "SC", "BD", "GL", "DZ"];
const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type Props = { onFechar: () => void; onAplicado?: () => void };

// Compras em que o "UN" da nota era pacote/caixa. O total da nota nunca muda: a
// embalagem so diz quantas unidades de contagem entraram (e o custo de cada uma).
export function RevisaoEmbalagens({ onFechar, onAplicado }: Props) {
  const [produtos, setProdutos] = useState<ProdutoDaRevisaoDeEmbalagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      setProdutos((await getRevisaoDeEmbalagens()).produtos);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível montar a revisão.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <section className="emb" aria-labelledby="emb-titulo">
      <header className="emb-topo">
        <div>
          <h2 id="emb-titulo"><PackageCheck size={18} aria-hidden="true" /> Revisar embalagens</h2>
          <p>
            Compras em que a nota diz "UN", mas o preço indica pacote ou caixa: custam 10 vezes ou mais que a compra mais barata do mesmo produto.
            Escolha a embalagem (ex.: PCT com 50 UN) ou confirme que era avulso. O total da nota não muda.
          </p>
        </div>
        <div className="emb-topo__acoes">
          <button type="button" className="icon-button" aria-label="Atualizar revisão" onClick={() => void carregar()} disabled={carregando}><RefreshCw size={16} /></button>
          <button type="button" className="icon-button" aria-label="Fechar revisão" onClick={onFechar}><X size={16} /></button>
        </div>
      </header>

      {carregando && !produtos && <p className="emb-estado" role="status"><Loader2 size={16} className="spin" aria-hidden="true" /> Procurando compras suspeitas…</p>}
      {erro && <p className="emb-estado emb-estado--erro" role="alert">{erro}</p>}
      {produtos && produtos.length === 0 && <p className="emb-estado">Nenhuma compra suspeita. Tudo certo com as embalagens.</p>}

      {produtos?.map((produto) => (
        <ProdutoDaRevisao key={produto.productId} produto={produto} onAplicado={() => { void carregar(); onAplicado?.(); }} />
      ))}
    </section>
  );
}

function embalagemInicial(produto: ProdutoDaRevisaoDeEmbalagem): { unidade: string; fator: string } {
  const cadastrada = produto.embalagens[0];
  if (cadastrada) return { unidade: cadastrada.unidade, fator: String(cadastrada.fator) };
  const doNome = produto.sugestaoDoNome[0];
  // Mediana das sugestoes pelo preco: o preco sobe com o tempo e a compra mais
  // recente sozinha sugere fator a mais (forminha: 60 em vez de 50).
  const fatores = produto.linhas.filter((l) => l.suspeita && l.fatorSugerido).map((l) => l.fatorSugerido as number).sort((a, b) => a - b);
  const doPreco = fatores.length ? fatores[Math.floor((fatores.length - 1) / 2)] : null;
  const unidade = doNome?.nivel === "caixa" ? "CX" : "PCT";
  const fator = doNome?.quantidade ?? doPreco;
  return { unidade, fator: fator ? String(fator) : "" };
}

function ProdutoDaRevisao({ produto, onAplicado }: { produto: ProdutoDaRevisaoDeEmbalagem; onAplicado: () => void }) {
  const inicial = useMemo(() => embalagemInicial(produto), [produto]);
  const [unidade, setUnidade] = useState(inicial.unidade);
  const [fator, setFator] = useState(inicial.fator);
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(produto.linhas.filter((l) => l.suspeita).map((l) => l.itemId)));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const contagem = produto.unidadeDeContagem;
  const fatorNumero = Number(fator.replace(",", "."));
  const fatorValido = Number.isFinite(fatorNumero) && fatorNumero > 1;

  function alternar(itemId: string) {
    setMarcadas((atual) => {
      const nova = new Set(atual);
      if (nova.has(itemId)) nova.delete(itemId); else nova.add(itemId);
      return nova;
    });
  }

  async function enviar(itens: Array<{ itemId: string; avulso?: true; unidade?: string; fator?: number }>) {
    setEnviando(true);
    setErro(null);
    try {
      await aplicarEmbalagens(itens);
      onAplicado();
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível aplicar.");
    } finally {
      setEnviando(false);
    }
  }

  const suspeitas = produto.linhas.filter((l) => l.suspeita);
  const aplicar = () => void enviar([...marcadas].map((itemId) => ({ itemId, unidade, fator: fatorNumero })));
  const avulsas = () => void enviar(suspeitas.filter((l) => !marcadas.has(l.itemId)).map((l) => ({ itemId: l.itemId, avulso: true as const })));

  return (
    <article className="emb-produto" aria-label={produto.produto}>
      <header className="emb-produto__topo">
        <div>
          <strong>{produto.produto}</strong>
          <small>
            Contado em {contagem}
            {produto.precoDeReferencia != null && <> · compra mais barata: <Money value={produto.precoDeReferencia} decimals={4} />/{contagem}</>}
          </small>
        </div>
        {produto.excesso > 0 && (
          <span className="emb-produto__excesso" title="Quanto as compras suspeitas pesariam a mais no custo do estoque se forem unidades de verdade">
            <Money value={produto.excesso} decimals={0} /> em jogo
          </span>
        )}
      </header>

      <div className="emb-produto__embalagem">
        <span>Embalagem:</span>
        <label className="emb-sr" htmlFor={`emb-un-${produto.productId}`}>Embalagem de {produto.produto}</label>
        <select id={`emb-un-${produto.productId}`} value={unidade} onChange={(e) => setUnidade(e.target.value)}>
          {[...new Set([...produto.embalagens.map((e) => e.unidade), ...EMBALAGENS])].map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <span>com</span>
        <label className="emb-sr" htmlFor={`emb-fator-${produto.productId}`}>Unidades por embalagem de {produto.produto}</label>
        <input id={`emb-fator-${produto.productId}`} inputMode="decimal" value={fator} placeholder="50" onChange={(e) => setFator(e.target.value.replace(/[^\d.,]/g, ""))} />
        <span>{contagem}</span>
        {produto.sugestaoDoNome[0] && <small className="emb-dica">Pelo nome: {produto.sugestaoDoNome[0].trecho}</small>}
      </div>

      <table className="emb-linhas">
        <thead>
          <tr><th scope="col"><span className="emb-sr">Aplicar embalagem</span></th><th scope="col">Data</th><th scope="col">Fornecedor / nota</th><th scope="col">Na nota</th><th scope="col">Total</th><th scope="col">Por {contagem}</th><th scope="col">Fica</th></tr>
        </thead>
        <tbody>
          {produto.linhas.map((linha) => {
            const marcada = marcadas.has(linha.itemId);
            return (
              <tr key={linha.itemId} className={linha.suspeita ? "emb-linha--suspeita" : linha.revisada ? "emb-linha--revisada" : undefined}>
                <td>
                  <input type="checkbox" checked={marcada} aria-label={`Aplicar embalagem na compra de ${formatDate(linha.data)}`} onChange={() => alternar(linha.itemId)} />
                </td>
                <td>{formatDate(linha.data)}</td>
                <td>{linha.fornecedor ?? "—"}{linha.notaFiscal ? <small> · NF {linha.notaFiscal}</small> : null}</td>
                <td>{formatoQuantidade.format(linha.quantidade)} {linha.unidade ?? ""}</td>
                <td><Money value={linha.total} /></td>
                <td><Money value={linha.precoUnitario} decimals={4} /></td>
                <td>
                  {marcada && fatorValido
                    ? <>{formatoQuantidade.format(linha.quantidade * fatorNumero)} {contagem} a <Money value={linha.total / (linha.quantidade * fatorNumero)} decimals={4} /></>
                    : linha.revisada ? <small>revisada</small> : linha.suspeita ? <small>parece {unidade}</small> : <small>avulso</small>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="emb-produto__acoes">
        <button type="button" className="primary-button" disabled={enviando || marcadas.size === 0 || !fatorValido} onClick={aplicar}>
          {enviando ? "Aplicando…" : `Aplicar ${unidade} com ${fatorValido ? formatoQuantidade.format(fatorNumero) : "?"} ${contagem} em ${marcadas.size} compra(s)`}
        </button>
        {suspeitas.some((l) => !marcadas.has(l.itemId)) && (
          <button type="button" className="secondary-button" disabled={enviando} onClick={avulsas}>
            Confirmar como avulsas as não marcadas
          </button>
        )}
        {erro && <p className="emb-estado emb-estado--erro" role="alert">{erro}</p>}
      </div>
    </article>
  );
}
