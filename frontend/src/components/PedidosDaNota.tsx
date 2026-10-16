import { useEffect, useMemo, useRef, useState } from "react";
import { getPedidosEmAbertoParaNota } from "../api/client";
import { Button, StatusBadge } from "../design-system";
import { formatDate, formatNumber } from "../utils/format";
import {
  agruparPorPedido,
  descartarOrfaos,
  lerQuantidade,
  produtosAcimaDaNota,
  sugerirParaNota,
  type ItemEmAberto
} from "../lib/vinculoPedido";

const STATUS: Record<string, string> = { RASCUNHO: "Rascunho", EM_REVISAO: "Em revisão", APROVADO: "Aprovado", ENVIADO: "Enviado", RECEBIDO_PARCIAL: "Recebido parcial", RECEBIDO: "Recebido" };

type Props = {
  supplierId: string;
  /** Compra em edição: traz os vínculos que ela já tem. */
  purchaseId: string | null;
  itensDaNota: Array<{ productId: string; quantity: number; unit?: string }>;
  /** purchaseOrderItemId → quantidade digitada; só entra quem tem quantidade válida. */
  valor: Record<string, string>;
  /** `carregado` só é verdadeiro depois de ler os pedidos: sem isso a tela não sabe o que já estava ligado e não deve regravar. */
  onChange: (valor: Record<string, string>, carregado: boolean) => void;
};

/**
 * Liga a nota aos pedidos de compra do fornecedor. Uma nota pode atender vários pedidos e um pedido pode
 * ser atendido por várias notas: a quantidade de cada item é a que esta nota cobre daquele pedido.
 */
export function PedidosDaNota({ supplierId, purchaseId, itensDaNota, valor, onChange }: Props) {
  const [abertos, setAbertos] = useState<ItemEmAberto[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const inicializadoPara = useRef<string | null>(null);
  const produtos = useMemo(() => {
    const pares = new Set(itensDaNota.filter((i) => i.productId).map((i) => `${i.productId}~${(i.unit ?? "").trim()}`));
    return [...pares].sort().map((par) => { const [productId, unit] = par.split("~"); return { productId, unit }; });
  }, [itensDaNota]);
  const chave = `${supplierId}|${purchaseId ?? ""}|${produtos.map((p) => `${p.productId}~${p.unit}`).join(",")}`;

  useEffect(() => {
    if (!supplierId || produtos.length === 0) {
      setAbertos([]);
      return;
    }
    let cancelado = false;
    const timer = window.setTimeout(() => {
      getPedidosEmAbertoParaNota({ supplierId, produtos, purchaseId })
        .then(({ items }) => {
          if (cancelado) return;
          setAbertos(items);
          setErro(null);
          const marcaInicial = `${supplierId}|${purchaseId ?? ""}`;
          if (inicializadoPara.current !== marcaInicial) {
            inicializadoPara.current = marcaInicial;
            const existentes = Object.fromEntries(items.filter((i) => i.vinculada != null).map((i) => [i.purchaseOrderItemId, String(i.vinculada)]));
            onChange(existentes, true);
          }
        })
        .catch((e: unknown) => {
          if (!cancelado) setErro(e instanceof Error ? e.message : "Não foi possível carregar os pedidos do fornecedor.");
        });
    }, 300);
    return () => { cancelado = true; window.clearTimeout(timer); };
    // onChange vem do pai e muda a cada render; a busca só depende do fornecedor, da nota e dos produtos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);

  const carregouAbertos = useRef(false);
  useEffect(() => {
    if (!carregouAbertos.current) {
      carregouAbertos.current = abertos.length > 0;
      return;
    }
    const limpo = descartarOrfaos(valor, abertos);
    if (Object.keys(limpo).length !== Object.keys(valor).length) onChange(limpo, true);
    // onChange vem do pai e muda a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abertos, valor]);

  const grupos = useMemo(() => agruparPorPedido(abertos), [abertos]);
  const ligados = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [id, texto] of Object.entries(valor)) {
      const q = lerQuantidade(texto);
      if (q != null) out[id] = q;
    }
    return out;
  }, [valor]);
  const acima = useMemo(() => produtosAcimaDaNota(ligados, abertos, itensDaNota), [ligados, abertos, itensDaNota]);

  if (erro) return <p className="muted pnova-pedidos-aviso" role="alert">{erro}</p>;
  if (grupos.length === 0) return null;

  function alternar(item: ItemEmAberto) {
    const proximo = { ...valor };
    if (proximo[item.purchaseOrderItemId] !== undefined) delete proximo[item.purchaseOrderItemId];
    else proximo[item.purchaseOrderItemId] = item.unidadeCompativel ? String(item.restante > 0 ? item.restante : item.vinculada ?? "") : "";
    onChange(proximo, true);
  }

  function sugerir() {
    const sugestao = sugerirParaNota(itensDaNota.map((i) => ({ productId: i.productId, quantity: Number(i.quantity) || 0 })), abertos);
    onChange(Object.fromEntries(Object.entries(sugestao).map(([id, q]) => [id, String(q)])), true);
  }

  return (
    <div className="pnova-pedidos-block">
      <div className="section-heading compact-heading">
        <div>
          <h3>Pedidos de compra</h3>
          <p className="muted">Este fornecedor tem pedido esperando entrega. Marque o que esta nota entregou; a nota pode atender mais de um pedido.</p>
        </div>
        <div className="action-row">
          <Button type="button" variant="secondary" onClick={sugerir}>Sugerir (mais antigo primeiro)</Button>
          <Button type="button" variant="secondary" onClick={() => onChange({}, true)} disabled={Object.keys(valor).length === 0}>Limpar</Button>
        </div>
      </div>
      {grupos.map((grupo) => (
        <section key={grupo.orderId} className="pnova-pedido-grupo" aria-label={`Pedido ${grupo.orderCode}`}>
          <header>
            <strong>{grupo.orderCode}</strong>
            <StatusBadge tone={grupo.orderStatus === "RASCUNHO" ? "warning" : "info"}>{STATUS[grupo.orderStatus] ?? grupo.orderStatus}</StatusBadge>
            <span className="muted">{formatDate(grupo.orderCreatedAt)}</span>
            {grupo.orderStatus === "RASCUNHO" && <span className="muted">· ainda não enviado pelo sistema; ao ligar a nota ele passa a Enviado</span>}
          </header>
          <ul>
            {grupo.itens.map((item) => {
              const marcado = valor[item.purchaseOrderItemId] !== undefined;
              return (
                <li key={item.purchaseOrderItemId}>
                  <label>
                    <input type="checkbox" checked={marcado} onChange={() => alternar(item)} />
                    <span className="pnova-pedido-produto">{item.productName}</span>
                  </label>
                  <span className="muted pnova-pedido-falta">
                    pediu {formatNumber(item.pedida)} {item.unit ?? ""} · falta {formatNumber(item.restante)}
                    {!item.unidadeCompativel && <strong className="pnova-pedidos-aviso"> · unidade diferente da nota</strong>}
                  </span>
                  <input
                    className="compact-input"
                    inputMode="decimal"
                    aria-label={`Quantidade que a nota entregou do pedido ${grupo.orderCode}, ${item.productName}`}
                    disabled={!marcado}
                    value={valor[item.purchaseOrderItemId] ?? ""}
                    onChange={(event) => onChange({ ...valor, [item.purchaseOrderItemId]: event.target.value }, true)}
                  />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {acima.length > 0 && <p className="pnova-pedidos-aviso" role="status">Passa do que a nota trouxe: {acima.join(", ")}. Confira as quantidades.</p>}
    </div>
  );
}
