import { Ban, Plus, Undo2 } from "lucide-react";
import { memo, useState } from "react";
import { conferirConversaoDoProduto, type PendenciaDeConversao, type ProdutoDaRotinaDeConversao, type StatusDaConversao } from "../../api/client";
import { Button, Money } from "../../design-system";
import { formatarQuantidade } from "../desperdicio/quantidade";
import { FormularioDaConversao, nomeDaUnidade } from "./FormularioDaConversao";

export const ROTULO_DO_STATUS: Record<StatusDaConversao, string> = {
  PENDENTE: "Pendente",
  PARCIAL: "Falta uma unidade",
  CADASTRADO: "Cadastrada",
  NAO_PRECISA: "Não precisa"
};

const ROTULO_DA_ORIGEM: Record<PendenciaDeConversao["origem"], string> = {
  COMPRA: "Já foi comprado nessa unidade",
  CADASTRO: "É a unidade de compra do cadastro",
  NOME_PECA: "O nome diz peça: quanto pesa 1 peça?"
};

type Props = {
  produto: ProdutoDaRotinaDeConversao;
  /** Unidades do cadastro que ainda podem ser convertidas neste produto (sem a do estoque e sem as já cadastradas). */
  unidadesParaAdicionar: string[];
  destacado: boolean;
  aoMudar: (mensagem: string) => void;
};

function CartaoBase({ produto, unidadesParaAdicionar, destacado, aoMudar }: Props) {
  const [adicionando, setAdicionando] = useState(false);
  const [unidadeExtra, setUnidadeExtra] = useState(unidadesParaAdicionar.includes("UN") ? "UN" : unidadesParaAdicionar[0] ?? "");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const resolvido = produto.status === "CADASTRADO" || produto.status === "NAO_PRECISA";
  const unidadesJaMostradas = new Set(produto.pendencias.map((p) => p.unidade));
  const opcoes = unidadesParaAdicionar.filter((u) => !unidadesJaMostradas.has(u));

  async function conferir(naoPrecisa: boolean) {
    setOcupado(true);
    setErro(null);
    try {
      await conferirConversaoDoProduto(produto.productId, naoPrecisa);
      aoMudar(naoPrecisa ? `${produto.nome}: conferido, não precisa de conversão.` : `${produto.nome}: voltou para as pendências.`);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível atualizar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <li className={`cv-cartao is-${produto.status.toLowerCase()}${destacado ? " is-destacado" : ""}`} data-produto={produto.productId} id={`cv-${produto.productId}`}>
      <div className="cv-topo">
        <div className="cv-titulo">
          <strong>{produto.nome}</strong>
          <span className={`cv-status is-${produto.status.toLowerCase()}`}>{ROTULO_DO_STATUS[produto.status]}</span>
        </div>
        <span className="muted">
          {produto.codigo ? `Cód. ${produto.codigo} · ` : ""}estoque em {produto.unidadeDeContagem}
          {produto.saldo != null ? ` · saldo ${formatarQuantidade(produto.saldo)} ${produto.unidadeDeContagem}` : ""}
          {produto.sectorName ? ` · ${produto.sectorName}` : ""}
          {produto.usosEmRequisicoes > 0 ? ` · pedido ${produto.usosEmRequisicoes}× em requisições (90 dias)` : ""}
        </span>
      </div>

      {produto.conversoes.length > 0 && (
        <ul className="cv-cadastradas" aria-label="Conversões cadastradas">
          {produto.conversoes.map((c) => <li key={`${c.fromUnit}-${c.toUnit}`}>1 {nomeDaUnidade(c.fromUnit)} = {formatarQuantidade(c.factor)} {c.toUnit}</li>)}
        </ul>
      )}

      {produto.status === "NAO_PRECISA" && (
        <p className="muted cv-conferido">Conferido{produto.conferidoPorNome ? ` por ${produto.conferidoPorNome}` : ""}: este produto não precisa de conversão.</p>
      )}

      {produto.status !== "NAO_PRECISA" && produto.pendencias.map((p) => (
        <div key={p.unidade} className="cv-linha">
          <p className="cv-origem">
            <b>{nomeDaUnidade(p.unidade)}</b> — {ROTULO_DA_ORIGEM[p.origem]}
            {p.linhas > 0 && <> · {p.linhas} {p.linhas === 1 ? "compra" : "compras"} (<Money value={p.valor} />)</>}
          </p>
          <FormularioDaConversao
            produtoId={produto.productId}
            contagem={produto.unidadeDeContagem}
            unidade={p.unidade}
            sugestao={p.proposta?.factor ?? null}
            rotuloDaSugestao={p.proposta ? `Sugestão do sistema (${p.proposta.confianca === "alta" ? "alta confiança" : "confira"}): ${p.proposta.motivo}` : undefined}
            aoSalvar={aoMudar}
          />
        </div>
      ))}

      {produto.status === "PENDENTE" && produto.pendencias.length === 0 && (
        <p className="muted cv-dica">Sem compra em outra unidade. Se a cozinha pede em outra unidade (peça, caixa...), cadastre; se não precisa, marque abaixo.</p>
      )}

      {adicionando && produto.status !== "NAO_PRECISA" && opcoes.length > 0 && (
        <div className="cv-linha">
          <label className="cv-unidade">
            <span className="rp-rotulo">Unidade a converter</span>
            <select aria-label={`Unidade a converter de ${produto.nome}`} value={unidadeExtra} onChange={(e) => setUnidadeExtra(e.target.value)}>
              {opcoes.map((u) => <option key={u} value={u}>{nomeDaUnidade(u)}</option>)}
            </select>
          </label>
          <FormularioDaConversao key={unidadeExtra} produtoId={produto.productId} contagem={produto.unidadeDeContagem} unidade={unidadeExtra} sugestao={null} aoSalvar={(m) => { setAdicionando(false); aoMudar(m); }} />
        </div>
      )}

      <div className="cv-acoes">
        {produto.status !== "NAO_PRECISA" && opcoes.length > 0 && !adicionando && (
          <Button variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => setAdicionando(true)}>{resolvido || produto.pendencias.length > 0 ? "Outra unidade" : "Cadastrar unidade"}</Button>
        )}
        {(produto.status === "PENDENTE" || produto.status === "PARCIAL") && (
          <Button variant="secondary" leadingIcon={<Ban size={14} />} disabled={ocupado} onClick={() => void conferir(true)}>Não precisa de conversão</Button>
        )}
        {produto.status === "NAO_PRECISA" && (
          <Button variant="secondary" leadingIcon={<Undo2 size={14} />} disabled={ocupado} onClick={() => void conferir(false)}>Voltar para as pendências</Button>
        )}
      </div>
      {erro && <p className="req-banner is-erro" role="alert"><span>{erro}</span></p>}
    </li>
  );
}

/** Um cartão por produto: a lista tem centenas e só o que a pessoa mexeu renderiza de novo. */
export const CartaoDeConversao = memo(CartaoBase);
