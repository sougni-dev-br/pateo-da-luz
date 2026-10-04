import { Pencil, Plus, RotateCcw, Search, Archive } from "lucide-react";
import { useMemo, useState } from "react";
import { deactivateBuffetPlateItem, saveBuffetPlateItem, type BuffetPlateItem } from "../../../api/client";
import { Alert, Button, EmptyState, Select, Switch, FormField } from "../../../design-system";
import { PratoDialog } from "./PratoDialog";
import { CATEGORIAS, semAcento } from "./plaquinhasFormato";

type Props = {
  catalogo: BuffetPlateItem[];
  podeCriar: boolean;
  podeEditar: boolean;
  podeExcluir: boolean;
  aoMudar: (prato: BuffetPlateItem) => void;
};

const LIMITE_LINHAS = 200;

export function CatalogoPlaquinhas({ catalogo, podeCriar, podeEditar, podeExcluir, aoMudar }: Props) {
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState("");
  const [verInativos, setVerInativos] = useState(false);
  const [editando, setEditando] = useState<BuffetPlateItem | null>(null);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const linhas = useMemo(() => {
    const termos = semAcento(texto).split(/\s+/).filter(Boolean);
    return catalogo.filter((p) => (verInativos || p.isActive) && (!categoria || p.category === categoria)
      && termos.every((t) => semAcento(`${p.namePt} ${p.nameEn}`).includes(t)));
  }, [catalogo, texto, categoria, verInativos]);

  async function alternarAtivo(p: BuffetPlateItem) {
    setErro(null);
    try {
      aoMudar(p.isActive ? await deactivateBuffetPlateItem(p.id) : await saveBuffetPlateItem({ namePt: p.namePt, nameEn: p.nameEn, category: p.category, isActive: true }, p.id));
    } catch (x) {
      setErro(x instanceof Error ? x.message : "Não foi possível alterar o prato.");
    }
  }

  const ativos = catalogo.filter((p) => p.isActive).length;

  return (
    <div className="plq-catalogo">
      <div className="plq-catalogo-filtros">
        <label className="plq-busca">
          <Search size={18} aria-hidden="true" />
          <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Procurar em português ou inglês" aria-label="Procurar prato" />
        </label>
        <Select aria-label="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}
          options={[{ value: "", label: "Todas as categorias" }, ...CATEGORIAS.map((c) => ({ value: c, label: c }))]} />
        <FormField label="Mostrar inativos" inline><Switch checked={verInativos} onChange={setVerInativos} /></FormField>
        {podeCriar && <Button onClick={() => setCriando(true)}><Plus size={16} /> Novo prato</Button>}
      </div>
      <p className="plq-contagem">{ativos} pratos no catálogo · {linhas.length} na busca</p>
      {erro && <Alert tone="error">{erro}</Alert>}

      {linhas.length === 0 ? (
        <EmptyState title="Nenhum prato encontrado" description="Mude a busca ou a categoria." />
      ) : (
        <div className="plq-tabela-rolagem">
          <table className="plq-tabela">
            <thead><tr><th>Português</th><th>Inglês</th><th>Categoria</th>{(podeEditar || podeExcluir) && <th aria-label="Ações" />}</tr></thead>
            <tbody>
              {linhas.slice(0, LIMITE_LINHAS).map((p) => (
                <tr key={p.id} className={p.isActive ? "" : "plq-inativo"}>
                  <td>{p.namePt}{!p.isActive && <small> · inativo</small>}</td>
                  <td className="plq-tabela-en">{p.nameEn}</td>
                  <td>{p.category}</td>
                  {(podeEditar || podeExcluir) && (
                    <td className="plq-tabela-acoes">
                      {podeEditar && <Button variant="icon" size="sm" aria-label={`Editar ${p.namePt}`} title="Editar" onClick={() => setEditando(p)}><Pencil size={16} /></Button>}
                      {(p.isActive ? podeExcluir : podeEditar) && (
                        <Button variant="icon" size="sm" aria-label={p.isActive ? `Inativar ${p.namePt}` : `Reativar ${p.namePt}`}
                          title={p.isActive ? "Inativar: sai da busca, mas continua nas listas antigas" : "Reativar"} onClick={() => alternarAtivo(p)}>
                          {p.isActive ? <Archive size={16} /> : <RotateCcw size={16} />}
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {linhas.length > LIMITE_LINHAS && <p className="plq-contagem">Mostrando {LIMITE_LINHAS} de {linhas.length}. Use a busca para achar o resto.</p>}
        </div>
      )}

      <PratoDialog aberto={criando || editando !== null} prato={editando} categoriaInicial={categoria || undefined}
        onFechar={() => { setCriando(false); setEditando(null); }}
        onSalvo={(p) => { aoMudar(p); setCriando(false); setEditando(null); }} />
    </div>
  );
}
