import { useState } from "react";
import { Link } from "react-router-dom";
import type { DetalhePedidosMetaCmv, PedidoNaContaMetaCmv } from "../../api/client";
import { Money } from "../../design-system";

const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: "Rascunho",
  EM_REVISAO: "Em revisão",
  APROVADO: "Aprovado",
  ENVIADO: "Enviado",
  RECEBIDO_PARCIAL: "Recebido parcial",
};

/** Listas longas (muitos rascunhos antigos) abrem com os primeiros e um botão para ver todos. */
const LIMITE_INICIAL = 5;

const dataCurta = (iso: string) => iso.split("-").reverse().join("/");

type Props = {
  detalhe: DetalhePedidosMetaCmv;
  /** Quem vê os pedidos de compra ganha o link para abrir cada um. */
  podeAbrirPedidos: boolean;
};

function Codigo({ pedido, podeAbrir }: { pedido: PedidoNaContaMetaCmv; podeAbrir: boolean }) {
  return podeAbrir
    ? <Link to={`/compras/pedidos?search=${encodeURIComponent(pedido.codigo)}`}>{pedido.codigo}</Link>
    : <span>{pedido.codigo}</span>;
}

function Grupo({ titulo, explicacao, pedidos, podeAbrir, valor }: {
  titulo: string; explicacao: string; pedidos: PedidoNaContaMetaCmv[]; podeAbrir: boolean; valor: "falta" | "total";
}) {
  const [todos, setTodos] = useState(false);
  if (pedidos.length === 0) return null;
  const visiveis = todos ? pedidos : pedidos.slice(0, LIMITE_INICIAL);
  return (
    <section className="mt-pedidos-grupo" aria-label={titulo}>
      <h4>{titulo} <span className="mt-sub">({pedidos.length})</span></h4>
      <p className="mt-ajuda">{explicacao}</p>
      <ul className="mt-pedidos-lista">
        {visiveis.map((p) => (
          <li key={p.id} className="mt-pedidos-linha">
            <span className="mt-pedidos-codigo"><Codigo pedido={p} podeAbrir={podeAbrir} /></span>
            <span className="mt-sub">{ROTULO_STATUS[p.status] ?? p.status} · {dataCurta(p.referencia)}</span>
            <span className="mt-pedidos-valor">
              {valor === "falta" ? <Money value={p.faltaCmv} /> : <Money value={p.totalCmv} />}
              {valor === "falta" && p.faltaCmv < p.totalCmv && <span className="mt-sub"> de <Money value={p.totalCmv} /></span>}
            </span>
          </li>
        ))}
      </ul>
      {pedidos.length > LIMITE_INICIAL && (
        <button type="button" className="mt-link" onClick={() => setTodos((v) => !v)}>
          {todos ? "Mostrar menos" : `Mostrar todos (${pedidos.length})`}
        </button>
      )}
    </section>
  );
}

/**
 * De onde vem o número de "pedidos em andamento": os pedidos que entram (só o que falta receber de CMV),
 * os parados que ficaram de fora e os rascunhos, que ainda não contam. A data é a entrega prevista ou,
 * sem previsão, a última movimentação do pedido.
 */
export function DetalhePedidos({ detalhe, podeAbrirPedidos }: Props) {
  const vazio = detalhe.contados.length + detalhe.parados.length + detalhe.rascunhos.length === 0;
  if (vazio) return <p className="mt-ajuda">Nenhum pedido de compra com itens de CMV em andamento.</p>;
  return (
    <div className="mt-pedidos">
      {detalhe.contados.length === 0 && <p className="mt-ajuda">Nenhum pedido entra na conta agora.</p>}
      <Grupo
        titulo="Entram na conta"
        explicacao="Em revisão, aprovados, enviados ou recebidos em parte, dos últimos 30 dias. Conta só o que ainda falta receber da parte de CMV."
        pedidos={detalhe.contados}
        podeAbrir={podeAbrirPedidos}
        valor="falta"
      />
      <Grupo
        titulo="Parados há mais de 30 dias (não contam)"
        explicacao="Provavelmente chegaram sem a nota ser ligada ao pedido, ou foram esquecidos. Ligue a nota ou encerre o pedido."
        pedidos={detalhe.parados}
        podeAbrir={podeAbrirPedidos}
        valor="falta"
      />
      <Grupo
        titulo="Rascunhos (não contam)"
        explicacao="Passam a contar quando vão para revisão. Valor da parte de CMV."
        pedidos={detalhe.rascunhos}
        podeAbrir={podeAbrirPedidos}
        valor="total"
      />
    </div>
  );
}
