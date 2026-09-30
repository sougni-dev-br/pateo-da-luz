// Filtro das tabelas da gorjeta: busca por texto (sem acento, sem caixa) e filtros de
// lista (vínculo, empresa, situação...). Fica guardado nesta aba do navegador enquanto
// ela estiver aberta — e a barra sempre diz quantos aparecem, para um filtro esquecido
// não esconder ninguém sem aviso.
import { Search, X } from "lucide-react";
import { useRef, useState } from "react";

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
  // O estado mais recente, para quem chama fora do render (efeito, limpeza ao sair da aba).
  const atual = useRef(estado);

  function gravar(novo: Estado) {
    atual.current = novo;
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

  const setValor = (chave: string, valor: string) =>
    gravar({ ...atual.current, valores: { ...atual.current.valores, [chave]: valor } });

  return {
    texto: estado.texto,
    valores: estado.valores,
    ativo,
    setTexto: (texto: string) => gravar({ ...atual.current, texto }),
    setValor,
    /** Tira o valor de uma lista só se ele ainda for `valor` (o usuário pode ter trocado). */
    limparValorSe: (chave: string, valor: string) => { if (atual.current.valores[chave] === valor) setValor(chave, ""); },
    limpar: () => gravar({ texto: "", valores: {} }),
    aplicar,
  };
}

/**
 * Valor gravado que não está mais entre as opções (outro mês, pessoa que saiu...).
 * Lista vazia = opções ainda carregando: não dá para saber, então não é "fora".
 */
export function valorForaDasOpcoes(valor: string | undefined, opcoes: FiltroLista["opcoes"]): boolean {
  return Boolean(valor) && opcoes.length > 0 && !opcoes.some((o) => o.valor === valor);
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
      {listas.map((l) => {
        const valor = filtro.valores[l.chave] ?? "";
        // Valor guardado que sumiu das opções continua filtrando: aparece como tal, em vez
        // de o select mostrar "todos" enquanto esconde gente.
        const fora = valorForaDasOpcoes(valor, l.opcoes);
        return (
          <select key={l.chave} value={valor} onChange={(e) => filtro.setValor(l.chave, e.target.value)}
            aria-label={l.rotulo} className={valor ? "barra-filtro-ativo" : undefined}>
            <option value="">{l.rotulo}: todos</option>
            {fora && <option value={valor}>{l.rotulo}: (não disponível)</option>}
            {l.opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        );
      })}
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

/** "MM/AAAA" → AAAAMM, para ordenar competências no tempo (texto ordenaria 01/2027 antes de 12/2026). */
export function chaveCompetencia(competencia: string | null | undefined): number | null {
  const m = /^(\d{1,2})\/(\d{4})$/.exec((competencia ?? "").trim());
  if (!m) return null;
  const mes = Number(m[1]);
  return mes >= 1 && mes <= 12 ? Number(m[2]) * 100 + mes : null;
}

/** Opções de competência ("MM/AAAA"), da mais recente para a mais antiga. */
export function opcoesCompetencia<T>(lista: T[], valor: (item: T) => string | null | undefined): FiltroLista["opcoes"] {
  return opcoesDe(lista, valor).sort((a, b) => (chaveCompetencia(b.valor) ?? -1) - (chaveCompetencia(a.valor) ?? -1));
}
