import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getWasteDishSuggestions, searchWasteDishes, searchWasteProducts, type WasteDishSuggestion, type WasteProductHit } from "../../api/client";
import { NovoPratoPendente } from "./NovoPratoPendente";

const MINIMO_CARACTERES = 2;
const ESPERA_DIGITACAO_MS = 300;

export type ModoDoItem = "INSUMO" | "PRATO";

type Props = {
  modo: ModoDoItem;
  selecionado: WasteProductHit | null;
  onSelecionar: (produto: WasteProductHit | null) => void;
  /** id do campo de busca: o formulário o usa para levar o foco ao primeiro erro. */
  idDoCampo: string;
  /** id da mensagem de erro do formulário, ligada ao campo por aria-describedby. */
  idDoErro?: string;
  invalido?: boolean;
};

// Busca própria (/waste/products e /waste/dishes): quem lança desperdício não precisa ter acesso ao módulo Produtos nem às Fichas.
export function BuscaProdutoDesperdicio({ modo, selecionado, onSelecionar, idDoCampo, idDoErro, invalido }: Props) {
  const [busca, setBusca] = useState("");
  const [sugestoes, setSugestoes] = useState<WasteProductHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Itens do buffet que ainda não são prato, e o cadastro de prato novo (nome de partida) quando aberto.
  const [dicasDoBuffet, setDicasDoBuffet] = useState<WasteDishSuggestion[]>([]);
  const [novo, setNovo] = useState<string | null>(null);
  const [devolverFoco, setDevolverFoco] = useState(false);
  const requisicaoAtual = useRef(0);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const termo = busca.trim();
    // Qualquer mudança invalida a resposta que ainda estiver voando: ela não pode repovoar a lista.
    const marca = ++requisicaoAtual.current;
    if (termo.length < MINIMO_CARACTERES) {
      setSugestoes([]);
      setDicasDoBuffet([]);
      setBuscando(false);
      setErro(null);
      return undefined;
    }
    setBuscando(true);
    const id = window.setTimeout(async () => {
      try {
        // As dicas do buffet são um extra: se falharem, a busca de pratos segue sem elas.
        const [achados, dicas] = await Promise.all([
          modo === "PRATO" ? searchWasteDishes(termo) : searchWasteProducts(termo),
          modo === "PRATO" ? getWasteDishSuggestions(termo).catch(() => [] as WasteDishSuggestion[]) : Promise.resolve([] as WasteDishSuggestion[]),
        ]);
        if (marca !== requisicaoAtual.current) return;
        setSugestoes(achados);
        setDicasDoBuffet(dicas);
        setErro(null);
      } catch (falha) {
        if (marca !== requisicaoAtual.current) return;
        setSugestoes([]);
        setDicasDoBuffet([]);
        setErro(falha instanceof Error ? falha.message : "Não foi possível buscar.");
      } finally {
        if (marca === requisicaoAtual.current) setBuscando(false);
      }
    }, ESPERA_DIGITACAO_MS);
    return () => window.clearTimeout(id);
  }, [busca, modo]);

  // Depois de "Trocar", o campo reaparece vazio: o foco volta a ele em vez de cair no topo da página.
  useEffect(() => {
    if (devolverFoco && !selecionado) {
      campo.current?.focus();
      setDevolverFoco(false);
    }
  }, [devolverFoco, selecionado]);

  if (selecionado) {
    return (
      <div className="waste-picked">
        <div>
          <strong>{selecionado.name}</strong>
          <span>{[selecionado.code, selecionado.sectorName].filter(Boolean).join(" · ") || "Sem código"}</span>
          {selecionado.pendente && <span className="waste-pending-tag">Aguardando ficha técnica: o valor aparece quando ela for concluída</span>}
        </div>
        <button
          type="button"
          className="waste-picked-clear"
          onClick={() => { setDevolverFoco(true); onSelecionar(null); }}
          aria-label={modo === "PRATO" ? "Trocar prato" : "Trocar produto"}
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  const termoCurto = busca.trim().length < MINIMO_CARACTERES;
  const nomeDaLista = modo === "PRATO" ? "Pratos encontrados" : "Produtos encontrados";
  const anuncio = termoCurto ? "" : buscando ? "Buscando…" : erro ? "" : `${sugestoes.length} ${sugestoes.length === 1 ? "resultado" : "resultados"}`;
  return (
    <div className="waste-search">
      <label className="waste-search-field">
        <Search size={16} aria-hidden />
        <input
          ref={campo}
          id={idDoCampo}
          type="search"
          value={busca}
          onChange={(event) => setBusca(event.target.value)}
          placeholder={modo === "PRATO" ? "Nome do prato" : "Código ou nome do produto"}
          aria-label={modo === "PRATO" ? "Buscar prato" : "Buscar produto"}
          aria-invalid={invalido || undefined}
          aria-describedby={invalido && idDoErro ? idDoErro : undefined}
          autoComplete="off"
        />
        {buscando && <Loader2 size={16} className="waste-spin" aria-hidden />}
      </label>
      <p className="waste-sr" role="status">{anuncio}</p>
      {erro && <p className="waste-search-note waste-error" role="alert">{erro}</p>}
      {!termoCurto && !buscando && !erro && sugestoes.length === 0 && <p className="waste-search-note">{modo === "PRATO" ? "Nenhum prato encontrado." : "Nenhum produto encontrado."}</p>}
      {sugestoes.length > 0 && (
        <ul className="waste-search-list" aria-label={nomeDaLista}>
          {sugestoes.map((produto) => (
            <li key={produto.id}>
              <button type="button" onClick={() => { setBusca(""); setSugestoes([]); onSelecionar(produto); }}>
                <strong>{produto.name}</strong>
                <span>{[produto.code, produto.sectorName, produto.unit, produto.pendente ? "aguardando ficha" : null].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {modo === "PRATO" && !termoCurto && !buscando && !erro && novo === null && (
        <div className="waste-novo">
          <p className="waste-search-note">{sugestoes.length === 0 ? "Não achou o prato?" : "Não é nenhum destes?"}</p>
          {dicasDoBuffet.length > 0 && (
            <ul className="waste-search-list" aria-label="Itens do buffet sem ficha">
              {dicasDoBuffet.map((dica) => (
                <li key={dica.name}>
                  <button type="button" onClick={() => setNovo(dica.name)}>
                    <strong>Cadastrar “{dica.name}”</strong>
                    <span>{dica.category} · item do buffet, ainda sem ficha</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="waste-link" onClick={() => setNovo(busca.trim())}>Cadastrar “{busca.trim()}” como prato novo</button>
        </div>
      )}
      {novo !== null && (
        <NovoPratoPendente
          nomeInicial={novo}
          onCancelar={() => setNovo(null)}
          onCriado={(prato) => { setNovo(null); setBusca(""); setSugestoes([]); setDicasDoBuffet([]); onSelecionar(prato); }}
        />
      )}
    </div>
  );
}
