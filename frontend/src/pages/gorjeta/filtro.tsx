// Filtro das tabelas da gorjeta: busca por texto (sem acento, sem caixa) e filtros de
// lista (vínculo, empresa, situação...). Fica guardado nesta aba do navegador enquanto
// ela estiver aberta — e a barra sempre diz quantos aparecem, para um filtro esquecido
// não esconder ninguém sem aviso.
import { Search, X } from "lucide-react";
import { useState } from "react";

export type FiltroLista = { chave: string; rotulo: string; opcoes: Array<{ valor: string; rotulo: string }> };
type Estado = { texto: string; valores: Record<string, string> };

const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function ler(chave: string): Estado {
  try {
    const bruto = window.sessionStorage.getItem(chave);
    if (!bruto) return { texto: "", valores: {} };
    const e = JSON.parse(bruto) as Partial<Estado>;
    return { texto: typeof e.texto === "string" ? e.texto : "", valores: e.valores && typeof e.valores === "object" ? e.valores as Record<string, string> : {} };
  } catch {
    return { texto: "", valores: {} };
  }
}

export function useFiltro(tabela: string) {
  const armazenamento = `gorjeta-filtro:${tabela}`;
  const [estado, setEstado] = useState<Estado>(() => ler(armazenamento));

  function gravar(novo: Estado) {
    setEstado(novo);
    try { window.sessionStorage.setItem(armazenamento, JSON.stringify(novo)); } catch { /* só não lembra */ }
  }

  const ativo = estado.texto.trim() !== "" || Object.values(estado.valores).some((v) => v !== "");

  /**
   * Aplica o filtro: `texto` diz onde procurar o que foi digitado (nome, apelido, função...);
   * `campos` diz, para cada filtro de lista, o valor da linha.
   */
  function aplicar<T>(lista: T[], texto: (item: T) => string, campos: Record<string, (item: T) => string | null | undefined> = {}): T[] {
    const busca = normalizar(estado.texto);
    const palavras = busca ? busca.split(/\s+/) : [];
    return lista.filter((item) => {
      if (palavras.length) {
        const alvo = normalizar(texto(item));
        if (!palavras.every((p) => alvo.includes(p))) return false;
      }
      for (const [chave, valor] of Object.entries(estado.valores)) {
        if (!valor || !campos[chave]) continue;
        if ((campos[chave](item) ?? "") !== valor) return false;
      }
      return true;
    });
  }

  return {
    texto: estado.texto,
    valores: estado.valores,
    ativo,
    setTexto: (texto: string) => gravar({ ...estado, texto }),
    setValor: (chave: string, valor: string) => gravar({ ...estado, valores: { ...estado.valores, [chave]: valor } }),
    limpar: () => gravar({ texto: "", valores: {} }),
    aplicar,
  };
}

type BarraProps = {
  filtro: ReturnType<typeof useFiltro>;
  listas?: FiltroLista[];
  total: number;
  visiveis: number;
  placeholder?: string;
};

export function BarraFiltro({ filtro, listas = [], total, visiveis, placeholder = "Filtrar por nome, apelido, função…" }: BarraProps) {
  return (
    <div className="barra-filtro" role="search">
      <label className="barra-filtro-busca">
        <Search size={14} aria-hidden />
        <input type="search" value={filtro.texto} onChange={(e) => filtro.setTexto(e.target.value)}
          placeholder={placeholder} aria-label="Filtrar a tabela" />
      </label>
      {listas.map((l) => (
        <select key={l.chave} value={filtro.valores[l.chave] ?? ""} onChange={(e) => filtro.setValor(l.chave, e.target.value)}
          aria-label={l.rotulo} className={filtro.valores[l.chave] ? "barra-filtro-ativo" : undefined}>
          <option value="">{l.rotulo}: todos</option>
          {l.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
        </select>
      ))}
      {filtro.ativo && (
        <span className="barra-filtro-contagem">
          {visiveis} de {total}
          <button type="button" className="barra-filtro-limpar" onClick={filtro.limpar}><X size={12} aria-hidden /> limpar filtro</button>
        </span>
      )}
    </div>
  );
}

/** Opções de um filtro de lista a partir dos valores que existem na tabela. */
export function opcoesDe<T>(lista: T[], valor: (item: T) => string | null | undefined): FiltroLista["opcoes"] {
  const vistos = [...new Set(lista.map(valor).filter((v): v is string => Boolean(v)))];
  return vistos.sort((a, b) => a.localeCompare(b, "pt-BR")).map((v) => ({ valor: v, rotulo: v }));
}
