import { Check, Lightbulb, Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getProducts, type Product } from "../api/client";

const MAX_SUGESTOES = 12;
const MINIMO_CARACTERES = 2;
const ESPERA_DIGITACAO_MS = 350;

type Props = {
  selecionado: Product | null;
  /** Descrição lida do documento — oferecida como busca pronta. */
  descricaoLida: string;
  /**
   * Palpite do sistema, com o motivo. Só chega aqui quando a confiança NÃO é
   * alta: o que é certo já vem preenchido. Fica como oferta de um clique, com
   * o motivo à vista, para a pessoa poder discordar com base.
   */
  sugestao?: { produto: Product; motivo: string } | null;
  onSelecionar: (produto: Product | null) => void;
};

/**
 * Busca de produto por código ou nome, no servidor.
 *
 * Um <select> com a base inteira nao serve: sao mais de 800 produtos e achar um
 * item rolando a lista e inviavel. A busca por codigo ou nome e o mesmo gesto da
 * tela de Compras, e a resposta do servidor volta em fracao de segundo.
 */
export function SeletorProduto({ selecionado, descricaoLida, sugestao, onSelecionar }: Props) {
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<Product[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const requisicaoAtual = useRef(0);

  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < MINIMO_CARACTERES) {
      setSugestoes([]);
      setBuscando(false);
      return undefined;
    }

    setBuscando(true);
    const id = window.setTimeout(async () => {
      const marca = ++requisicaoAtual.current;
      try {
        const pagina = await getProducts({ search: termo, isActive: "true", pageSize: MAX_SUGESTOES });
        // Resposta de busca antiga nao pode sobrescrever a mais recente.
        if (marca !== requisicaoAtual.current) return;
        setSugestoes(pagina.items);
        setErro(null);
      } catch (falha) {
        if (marca !== requisicaoAtual.current) return;
        setErro((falha as Error).message);
        setSugestoes([]);
      } finally {
        if (marca === requisicaoAtual.current) setBuscando(false);
      }
    }, ESPERA_DIGITACAO_MS);

    return () => window.clearTimeout(id);
  }, [busca]);

  if (selecionado) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Check size={14} color="var(--success, green)" />
          <strong style={{ fontSize: 13 }}>{selecionado.name}</strong>
          <button
            type="button"
            onClick={() => { onSelecionar(null); setBusca(""); }}
            title="Trocar produto"
            aria-label="Trocar produto"
            style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", display: "inline-flex" }}
          >
            <X size={13} />
          </button>
        </div>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>
          {selecionado.category?.name ?? "sem categoria"}
          {selecionado.subcategory?.name ? ` › ${selecionado.subcategory.name}` : ""}
          {selecionado.unit ? ` · ${selecionado.unit}` : ""}
        </span>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {buscando ? <Loader2 size={13} color="var(--muted)" /> : <Search size={13} color="var(--muted)" />}
        <input
          type="text"
          value={busca}
          placeholder="Código ou nome do produto…"
          aria-label="Buscar produto"
          onChange={(evento) => { setBusca(evento.target.value); setAberto(true); }}
          onFocus={() => setAberto(true)}
          style={{ flex: 1, padding: "6px 8px", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13, minWidth: 0 }}
        />
      </div>

      {busca.trim().length < MINIMO_CARACTERES && sugestao && (
        <button
          type="button"
          onClick={() => onSelecionar(sugestao.produto)}
          title={`Usar ${sugestao.produto.name}`}
          style={{ marginTop: 4, display: "block", textAlign: "left", border: "1px dashed var(--border)", borderRadius: 6, background: "transparent", padding: "4px 8px", fontSize: 11, color: "var(--muted)", cursor: "pointer", maxWidth: "100%" }}
        >
          <Lightbulb size={11} style={{ verticalAlign: "-1px" }} /> usar <strong>{sugestao.produto.name}</strong> — {sugestao.motivo}
        </button>
      )}

      {busca.trim().length < MINIMO_CARACTERES && !sugestao && descricaoLida && (
        <button
          type="button"
          onClick={() => { setBusca(descricaoLida.slice(0, 40)); setAberto(true); }}
          style={{ marginTop: 4, border: "none", background: "transparent", padding: 0, fontSize: 11, color: "var(--muted)", cursor: "pointer", textAlign: "left" }}
        >
          buscar por “{descricaoLida.slice(0, 40)}”
        </button>
      )}

      {aberto && sugestoes.length > 0 && (
        <ul style={{
          position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, margin: "4px 0 0",
          padding: 0, listStyle: "none", background: "var(--surface, #fff)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)", maxHeight: 240, overflowY: "auto",
        }}>
          {sugestoes.map((produto) => (
            <li key={produto.id}>
              <button
                type="button"
                onClick={() => { onSelecionar(produto); setAberto(false); }}
                style={{ width: "100%", textAlign: "left", padding: "7px 10px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13 }}
              >
                <div>{produto.name}</div>
                <small style={{ color: "var(--muted)" }}>
                  {produto.externalCode ? `${produto.externalCode} · ` : ""}
                  {produto.category?.name ?? "sem categoria"}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}

      {aberto && !buscando && busca.trim().length >= MINIMO_CARACTERES && sugestoes.length === 0 && (
        <div style={{ marginTop: 4, fontSize: 11, color: erro ? "var(--danger, #c00)" : "var(--muted)" }}>
          {erro ?? "Nenhum produto encontrado."}
        </div>
      )}
    </div>
  );
}
