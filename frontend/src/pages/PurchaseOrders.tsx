import { AlertTriangle, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppUser, downloadPurchaseOrderPdf, getPurchaseOrders, PurchaseOrder } from "../api/client";
import { Notice, useNotice } from "../components/Notice";
import { Button, EmptyState, IconButton, Money } from "../design-system";
import { hasPermission } from "../lib/permissions";
import { DetalhePedido } from "./purchase-orders/DetalhePedido";
import { ListaPedidos } from "./purchase-orders/ListaPedidos";
import {
  contagemPorVista,
  type Etapa,
  filtrarPedidos,
  pluralPedidos,
  totaisPorEtapa,
  valorDo,
  type Vista,
  vistaDaEtapa
} from "./purchase-orders/regras";
import { ResumoPedidos } from "./purchase-orders/ResumoPedidos";
import "./compras/lista-compras.css";
import "./payables/payables.css";
import "./purchase-orders/pedidos.css";

const VISTAS: Array<{ chave: Vista; rotulo: string }> = [
  { chave: "abertos", rotulo: "Em aberto" },
  { chave: "concluidos", rotulo: "Concluídos" },
  { chave: "cancelados", rotulo: "Cancelados" },
  { chave: "todos", rotulo: "Todos" }
];

const VAZIO: Record<Vista, string> = {
  abertos: "Nenhum pedido em aberto. Gere pedidos pela requisição de insumos ou pelo planejamento de compra.",
  concluidos: "Nenhum pedido recebido ainda.",
  cancelados: "Nenhum pedido cancelado.",
  todos: "Nenhum pedido de compra. Gere pedidos pela requisição de insumos ou pelo planejamento de compra."
};

/** Hoje no calendário local (AAAA-MM-DD), para comparar com a previsão de entrega. */
function hojeLocal(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
}

export function PurchaseOrders({ user }: { user: AppUser }) {
  const { notice, setNotice } = useNotice();
  const [searchParams] = useSearchParams();
  const [pedidos, setPedidos] = useState<PurchaseOrder[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState(() => (searchParams.get("search") ?? "").slice(0, 200));
  // Quem chega por link (requisição, planejamento) procura um pedido que pode já estar recebido: abre em "Todos".
  const [vista, setVista] = useState<Vista>(() => (searchParams.get("search") ? "todos" : "abertos"));
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);

  const permissoes = {
    operar: hasPermission(user, "purchase-orders", "edit"),
    aprovar: hasPermission(user, "purchase-orders", "approve"),
    // O aviso de meta mostra faturamento e CMV: só para quem vê o CMV Real.
    verMetaCmv: hasPermission(user, "cmv-real", "view")
  };

  // A lista inteira vem de uma vez (são poucas centenas): a busca e as abas filtram aqui, sem esperar o servidor.
  // Duas cargas seguidas (salvar e depois mudar o status) podem responder fora de ordem: só a última vale.
  const ultimaCarga = useRef(0);
  const carregar = useCallback(async () => {
    const numero = ++ultimaCarga.current;
    setCarregando(true);
    setErro(null);
    try {
      const dados = await getPurchaseOrders();
      if (numero === ultimaCarga.current) setPedidos(dados.orders);
    } catch (falha) {
      if (numero === ultimaCarga.current) setErro(falha instanceof Error ? falha.message : "Não foi possível carregar os pedidos.");
    } finally {
      if (numero === ultimaCarga.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const hoje = hojeLocal();
  const totais = useMemo(() => totaisPorEtapa(pedidos), [pedidos]);
  const contagem = useMemo(() => contagemPorVista(pedidos), [pedidos]);
  const visiveis = useMemo(() => filtrarPedidos(pedidos, { vista, etapa, busca }), [pedidos, vista, etapa, busca]);
  const totalVisivel = useMemo(() => visiveis.reduce((soma, p) => soma + valorDo(p), 0), [visiveis]);

  function escolherEtapa(nova: Etapa | null) {
    setEtapa(nova);
    if (nova) setVista(vistaDaEtapa(nova));
  }

  function escolherVista(nova: Vista) {
    setEtapa(null);
    setVista(nova);
  }

  const filtrando = busca.trim() !== "" || etapa != null;
  const vazio = (
    <EmptyState
      title={filtrando ? "Nenhum pedido encontrado" : "Nada por aqui"}
      description={filtrando ? `Nenhum pedido ${vista === "todos" ? "" : `${VISTAS.find((v) => v.chave === vista)?.rotulo.toLowerCase()} `}bate com a busca ou a etapa escolhida.` : VAZIO[vista]}
      action={filtrando ? (
        <span className="po-vazio-acoes">
          {vista !== "todos" && busca.trim() !== "" && <Button size="sm" onClick={() => escolherVista("todos")}>Buscar em todos</Button>}
          <Button variant="secondary" size="sm" onClick={() => { setBusca(""); setEtapa(null); }}>Limpar filtros</Button>
        </span>
      ) : undefined}
    />
  );

  return (
    <section className="panel">
      <Notice notice={notice} />

      <div className="cp-tela po-tela">
        <ResumoPedidos totais={totais} ativa={etapa} onEtapa={escolherEtapa} />

        <div className="cp-vistas">
          <div className="cp-segmento" role="group" aria-label="Situação dos pedidos">
            {VISTAS.map((v) => (
              <button key={v.chave} type="button" aria-pressed={vista === v.chave} onClick={() => escolherVista(v.chave)}>
                {v.rotulo} <span className="po-contagem">{contagem[v.chave]}</span>
              </button>
            ))}
          </div>
          <div className="cp-busca po-busca">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por código ou fornecedor"
              aria-label="Buscar pedido por código ou fornecedor"
            />
            {busca && (
              <button type="button" className="cp-busca-limpar" aria-label="Limpar busca" onClick={() => setBusca("")}>
                <X size={15} />
              </button>
            )}
          </div>
          <IconButton icon={<RefreshCw size={16} />} label="Atualizar pedidos" size="sm" onClick={() => void carregar()} disabled={carregando} />
        </div>

        <div className="cp-resultado" aria-live="polite">
          <span className="cp-resultado-qtd">{carregando ? "Carregando…" : pluralPedidos(visiveis.length)}</span>
          {!carregando && visiveis.length > 0 && <strong className="cp-num"><Money value={totalVisivel} /></strong>}
          {etapa && (
            <button type="button" className="cp-link po-limpar-etapa" onClick={() => setEtapa(null)}>
              Mostrar todas as etapas
            </button>
          )}
          <span className="cp-resultado-periodo">soma do valor estimado</span>
        </div>

        {carregando ? (
          <div className="cp-carregando" role="status" aria-label="Carregando pedidos">
            {[0, 1, 2, 3].map((i) => <div key={i} className="cp-esqueleto" />)}
          </div>
        ) : erro ? (
          <div className="cp-erro" role="alert">
            <AlertTriangle size={20} aria-hidden="true" />
            <div>
              <strong>Não foi possível carregar os pedidos.</strong>
              <p>{erro}</p>
            </div>
            <Button variant="secondary" size="sm" leadingIcon={<RefreshCw size={14} />} onClick={() => void carregar()}>Tentar de novo</Button>
          </div>
        ) : (
          <ListaPedidos
            pedidos={visiveis}
            hoje={hoje}
            vazio={vazio}
            onAbrir={(pedido) => setAbertoId(pedido.id)}
            onPdf={(pedido) => void downloadPurchaseOrderPdf(pedido.id, pedido.code).catch((falha) =>
              setNotice({ tone: "error", message: falha instanceof Error ? falha.message : "Não foi possível baixar o PDF." }))}
          />
        )}
      </div>

      {abertoId && (
        <DetalhePedido
          key={abertoId}
          pedidoId={abertoId}
          permissoes={permissoes}
          onFechar={() => setAbertoId(null)}
          onMudou={(mensagem) => {
            setNotice({ tone: "success", message: mensagem });
            void carregar();
          }}
        />
      )}
    </section>
  );
}
