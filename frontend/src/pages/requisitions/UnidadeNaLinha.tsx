import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { getUnits, type RequisitionCatalogItem } from "../../api/client";
import { normalizarUnidade } from "../../lib/fichaTecnica";
import { FormularioDaConversao } from "../conversoes/FormularioDaConversao";

export type ConversaoNova = { fromUnit: string; toUnit: string; factor: number };

type Props = {
  item: RequisitionCatalogItem;
  onCadastrada: (item: RequisitionCatalogItem, conversao: ConversaoNova) => void;
  onFechar: () => void;
};

// A lista de unidades é a mesma para todas as linhas: busca uma vez.
let unidadesEmCache: Promise<string[]> | null = null;
const carregarUnidades = () => {
  unidadesEmCache ??= getUnits().then((lista) => lista.filter((u) => u.isActive !== false).map((u) => u.code)).catch(() => {
    unidadesEmCache = null;
    return [] as string[];
  });
  return unidadesEmCache;
};

/**
 * "1 PÇ = [3,5] KG" na própria linha da requisição: o produto sem a conversão que a pessoa precisa
 * deixa de ser um beco sem saída, e a conversão fica cadastrada para todos os próximos pedidos.
 */
export function UnidadeNaLinha({ item, onCadastrada, onFechar }: Props) {
  const [unidades, setUnidades] = useState<string[] | null>(null);
  const base = normalizarUnidade(item.unit) || "UN";
  const [escolhida, setEscolhida] = useState("");

  useEffect(() => {
    let ativo = true;
    carregarUnidades().then((lista) => {
      if (!ativo) return;
      const ja = new Set(item.conversions.map((c) => normalizarUnidade(c.fromUnit)));
      const livres = lista.filter((u) => normalizarUnidade(u) !== base && !ja.has(normalizarUnidade(u)));
      setUnidades(livres);
      setEscolhida((atual) => atual || (livres.includes("PÇ") ? "PÇ" : livres.includes("UN") ? "UN" : livres[0] ?? ""));
    });
    return () => { ativo = false; };
  }, [item.conversions, base]);

  return (
    <div className="rq-nova-unidade" role="group" aria-label={`Cadastrar outra unidade para ${item.name}`}>
      <div className="rq-nova-unidade-topo">
        <span>Quanto vale 1 unidade de medida em {base}? Fica cadastrado para todos os próximos pedidos.</span>
        <button type="button" className="rq-nova-unidade-fechar" aria-label="Fechar" onClick={onFechar}><X size={14} /></button>
      </div>
      {unidades == null ? (
        <span className="muted">Carregando unidades…</span>
      ) : unidades.length === 0 ? (
        <span className="muted">Este produto já tem todas as unidades cadastradas.</span>
      ) : (
        <>
          <select className="rq-unidade-select" aria-label="Unidade a cadastrar" value={escolhida} onChange={(e) => setEscolhida(e.target.value)}>
            {unidades.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <FormularioDaConversao
            key={escolhida}
            produtoId={item.id}
            contagem={base}
            unidade={escolhida}
            sugestao={null}
            aoSalvar={(_mensagem, conversao) => onCadastrada(item, conversao)}
          />
        </>
      )}
    </div>
  );
}
