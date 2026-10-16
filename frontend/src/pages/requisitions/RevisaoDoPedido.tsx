import { ArrowLeft, CheckCircle2, ShoppingCart } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  createPurchaseOrdersFromRequisition,
  getRequisitionPurchaseDraft,
  type PurchaseOrderFromPlanningResult,
  type RequisitionPurchaseDraft
} from "../../api/client";
import { Button, Money } from "../../design-system";
import { EnvioDoPedido } from "../../components/EnvioDoPedido";
import { formatDate } from "../../utils/format";
import { LinhaDoPedido } from "./LinhaDoPedido";
import { decisoesIniciais, itensParaEnviar, podeGerar, resumirPedido, situacaoDoItem, type DecisaoDoItem, type Decisoes } from "./pedido";

type Props = {
  requisicaoId: string;
  /** Quem pode aprovar o pedido (aprovar é o passo antes de mandar ao fornecedor). */
  canApprove: boolean;
  canSend: boolean;
  onVoltar: () => void;
  onAbrirPedidos: (busca: string) => void;
};

type Filtro = "TODOS" | "ALTERADOS" | "SEM_FORNECEDOR" | "FORA";

/**
 * Revisão antes de virar pedido de compra: a requisição diz o que saiu; aqui a pessoa decide quanto comprar e de quem.
 * O que ficar nesta tela é o que vale para o pedido (a retirada fica guardada só como sugestão).
 */
export function RevisaoDoPedido({ requisicaoId, canApprove, canSend, onVoltar, onAbrirPedidos }: Props) {
  const [rascunho, setRascunho] = useState<RequisitionPurchaseDraft | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [decisoes, setDecisoes] = useState<Decisoes>({});
  const [filtro, setFiltro] = useState<Filtro>("TODOS");
  // Foto dos itens do filtro ao escolhê-lo: editar uma quantidade não pode tirar a linha dos dedos (e o foco com ela).
  const [congelados, setCongelados] = useState<Set<string> | null>(null);
  const [entrega, setEntrega] = useState("");
  const [observacao, setObservacao] = useState("");
  const [outroPedido, setOutroPedido] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<PurchaseOrderFromPlanningResult | null>(null);

  useEffect(() => {
    let ativo = true;
    getRequisitionPurchaseDraft(requisicaoId)
      .then((dados) => {
        if (!ativo) return;
        setRascunho(dados);
        setDecisoes(decisoesIniciais(dados.items));
      })
      .catch((e: unknown) => {
        if (ativo) setFalhou(e instanceof Error ? e.message : "Não foi possível carregar a requisição.");
      });
    return () => {
      ativo = false;
    };
  }, [requisicaoId]);

  const itens = rascunho?.items ?? [];
  const resumo = useMemo(() => resumirPedido(itens, decisoes), [itens, decisoes]);
  const jaGerou = (rascunho?.existingOrders.length ?? 0) > 0;
  const liberado = podeGerar(resumo) && (!jaGerou || outroPedido) && !gerando;

  const mudar = useCallback((productId: string, parcial: Partial<DecisaoDoItem>) => {
    setErro(null);
    setDecisoes((atuais) => ({ ...atuais, [productId]: { ...(atuais[productId] ?? { quantity: "", supplierId: null }), ...parcial } }));
  }, []);

  const voltarAoSugerido = useCallback((productId: string) => {
    const item = rascunho?.items.find((i) => i.productId === productId);
    if (item) setDecisoes((atuais) => ({ ...atuais, [productId]: { ...atuais[productId], quantity: decisoesIniciais([item])[productId].quantity } }));
  }, [rascunho]);

  const casaComFiltro = useCallback((item: (typeof itens)[number], qual: Filtro) => {
    const s = situacaoDoItem(item, decisoes[item.productId]);
    return qual === "ALTERADOS" ? s.alterada : qual === "SEM_FORNECEDOR" ? s.semFornecedor : qual === "FORA" ? s.foraDoPedido : true;
  }, [decisoes]);

  const escolherFiltro = useCallback((qual: Filtro) => {
    setCongelados(qual === "TODOS" ? null : new Set(itens.filter((i) => casaComFiltro(i, qual)).map((i) => i.productId)));
    setFiltro(qual);
  }, [itens, casaComFiltro]);

  const visiveis = useMemo(() => (filtro === "TODOS" || !congelados ? itens : itens.filter((i) => congelados.has(i.productId))), [itens, filtro, congelados]);

  async function gerar() {
    if (!liberado || !rascunho) return;
    setGerando(true);
    setErro(null);
    try {
      setResultado(await createPurchaseOrdersFromRequisition(requisicaoId, {
        items: itensParaEnviar(itens, decisoes),
        expectedDeliveryDate: entrega || null,
        notes: observacao.trim() || null,
        confirmarOutroPedido: outroPedido
      }));
    } catch (falha) {
      setErro(falha instanceof ApiError || falha instanceof Error ? falha.message : "Não foi possível gerar o pedido.");
      if (falha instanceof ApiError && falha.status === 409) {
        // Outra pessoa gerou antes: recarrega para mostrar os pedidos que já existem e a confirmação, sem perder as decisões.
        getRequisitionPurchaseDraft(requisicaoId).then((dados) => setRascunho(dados)).catch(() => {});
      }
    } finally {
      setGerando(false);
    }
  }

  if (falhou) {
    return (
      <div className="rq-bloco rq-vazio" role="alert">
        <strong>{falhou}</strong>
        <Button variant="secondary" leadingIcon={<ArrowLeft size={14} />} onClick={onVoltar}>Voltar</Button>
      </div>
    );
  }

  if (!rascunho) {
    return <ul className="rq-lista rq-esqueleto rq-bloco" aria-busy="true" aria-label="Carregando a requisição">{Array.from({ length: 5 }, (_, i) => <li key={i} className="rq-linha" />)}</ul>;
  }

  if (resultado) {
    return (
      <section className="rq-bloco rp-resultado" aria-live="polite">
        <CheckCircle2 size={30} className="req-success-icon" aria-hidden />
        <h3>{resultado.createdOrders.length === 1 ? "Pedido criado" : `${resultado.createdOrders.length} pedidos criados`}</h3>
        <p className="muted">Agora é só aprovar, gerar o PDF e mandar ao fornecedor. A quantidade que você confirmou é a que vale.</p>
        <ul className="rp-pedidos">
          {resultado.createdOrders.map((pedido) => (
            <li key={pedido.id}>
              <EnvioDoPedido orderId={pedido.id} canApprove={canApprove} canSend={canSend} />
              {pedido.totalEstimated > 0 && <span className="muted">Total estimado <Money value={pedido.totalEstimated} /></span>}
            </li>
          ))}
        </ul>
        {resultado.skippedItems.length > 0 && (
          <div className="req-banner is-aviso" role="alert"><span>{resultado.skippedItems.length} {resultado.skippedItems.length === 1 ? "item ficou" : "itens ficaram"} de fora: {resultado.skippedItems.map((i) => (i.productName ? `${i.productName}: ${i.reason}` : i.reason)).join(" ")}</span></div>
        )}
        <div className="rp-resultado-acoes">
          <Button variant="primary" leadingIcon={<ShoppingCart size={14} />} onClick={() => onAbrirPedidos(resultado.createdOrders[0]?.code ?? "")}>Ver em Pedidos de compra</Button>
          <Button variant="secondary" onClick={onVoltar}>Voltar às requisições</Button>
        </div>
      </section>
    );
  }

  const contar = (f: Filtro) => itens.filter((i) => casaComFiltro(i, f)).length;

  return (
    <div className="rq">
      <section className="rq-cabecalho rp-topo">
        <button type="button" className="rp-voltar" onClick={onVoltar}><ArrowLeft size={16} aria-hidden /> Voltar</button>
        <h3>Pedido de compra a partir de {rascunho.requisition.code}</h3>
        <p className="muted">
          Retirada de {formatDate(rascunho.requisition.date)}{rascunho.requisition.sectorName ? ` · ${rascunho.requisition.sectorName}` : ""}.
          Confira as quantidades: <strong>o que ficar aqui é o que vale para o pedido</strong>. Deixe vazio o que não quiser comprar.
        </p>
      </section>

      {jaGerou && (
        <div className="req-banner is-aviso" role="alert">
          <span>
            Esta requisição já gerou {rascunho.existingOrders.map((p) => p.code).join(", ")}.
            <label className="rq-opcao"><input type="checkbox" checked={outroPedido} onChange={(e) => setOutroPedido(e.target.checked)} /> Gerar outro pedido mesmo assim</label>
          </span>
        </div>
      )}

      <section className="rq-bloco" aria-label="Itens do pedido">
        <div className="rq-fixos">
          <div className="rq-chips" role="group" aria-label="O que mostrar">
            <button type="button" aria-pressed={filtro === "TODOS"} className={filtro === "TODOS" ? "is-ativo" : undefined} onClick={() => escolherFiltro("TODOS")}>Todos <span className="rq-chip-n">{itens.length}</span></button>
            <button type="button" aria-pressed={filtro === "ALTERADOS"} className={filtro === "ALTERADOS" ? "is-ativo" : undefined} onClick={() => escolherFiltro("ALTERADOS")}>Alterados <span className="rq-chip-n">{contar("ALTERADOS")}</span></button>
            {(contar("SEM_FORNECEDOR") > 0 || filtro === "SEM_FORNECEDOR") && <button type="button" aria-pressed={filtro === "SEM_FORNECEDOR"} className={`is-problema${filtro === "SEM_FORNECEDOR" ? " is-ativo" : ""}`} onClick={() => escolherFiltro("SEM_FORNECEDOR")}>Sem fornecedor <span className="rq-chip-n">{contar("SEM_FORNECEDOR")}</span></button>}
            <button type="button" aria-pressed={filtro === "FORA"} className={filtro === "FORA" ? "is-ativo" : undefined} onClick={() => escolherFiltro("FORA")}>Fora do pedido <span className="rq-chip-n">{contar("FORA")}</span></button>
          </div>
        </div>
        {visiveis.length > 0 ? (
          <ul className="rq-lista">
            {visiveis.map((item) => (
              <LinhaDoPedido key={item.productId} item={item} decisao={decisoes[item.productId]} fornecedores={rascunho.suppliers} onMudar={mudar} onVoltarAoSugerido={voltarAoSugerido} />
            ))}
          </ul>
        ) : (
          <div className="rq-vazio"><strong>Nenhum item neste filtro.</strong></div>
        )}
        <details className="rp-extras">
          <summary>Previsão de entrega e observação (opcional)</summary>
          <label className="req-field"><span>Entrega prevista</span><input type="date" value={entrega} onChange={(e) => setEntrega(e.target.value)} /></label>
          <label className="req-field"><span>Observação para o pedido</span><input value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" /></label>
        </details>
      </section>

      {erro && <div className="req-banner is-erro" role="alert"><span>{erro}</span></div>}

      <div className="rq-barra">
        <div className="rq-barra-resumo" aria-live="polite">
          <strong>{resumo.itens} {resumo.itens === 1 ? "item" : "itens"} · {resumo.fornecedores} {resumo.fornecedores === 1 ? "fornecedor" : "fornecedores"}</strong>
          {resumo.semFornecedor.length > 0 ? (
            <button type="button" className="rq-barra-problema" onClick={() => escolherFiltro("SEM_FORNECEDOR")}>{resumo.semFornecedor.length} sem fornecedor — ver</button>
          ) : resumo.invalidos.length > 0 ? (
            <span>{resumo.invalidos.length} com quantidade inválida</span>
          ) : (
            <span>
              {resumo.total > 0 ? <>≈ <Money value={resumo.total} />{resumo.semPreco > 0 ? ` + ${resumo.semPreco} sem preço` : ""}</> : "sem preço de referência"}
            </span>
          )}
        </div>
        <Button variant="primary" leadingIcon={<ShoppingCart size={16} />} onClick={gerar} disabled={!liberado}>{gerando ? "Gerando…" : "Gerar pedido"}</Button>
      </div>
    </div>
  );
}
