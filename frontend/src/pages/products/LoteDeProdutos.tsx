import { useMemo, useState } from "react";
import {
  organizarProdutosEmLote,
  type AlvoDoLote,
  type Category,
  type InventorySector,
  type NatureOption,
  type ResumoDoLote,
  type Subcategory
} from "../../api/client";
import {
  LIMPAR,
  LOTE_VAZIO,
  MANTER,
  comCategoria,
  descricaoDasMudancas,
  mudancasDoFormulario,
  temMudanca,
  type FormularioDoLote
} from "./lote";

type Props = {
  alvo: AlvoDoLote;
  quantidade: number;
  /** Categoria do filtro atual: deixa escolher a subcategoria sem trocar a categoria. */
  categoriaDoFiltroId?: string;
  categories: Category[];
  subcategories: Subcategory[];
  sectors: InventorySector[];
  natures: NatureOption[];
  onAplicado: (resumo: ResumoDoLote) => void;
  onFechar: () => void;
};

export function LoteDeProdutos({ alvo, quantidade, categoriaDoFiltroId, categories, subcategories, sectors, natures, onAplicado, onFechar }: Props) {
  const [form, setForm] = useState<FormularioDoLote>(LOTE_VAZIO);
  const [resumo, setResumo] = useState<ResumoDoLote | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const categoriasAtivas = useMemo(() => categories.filter((c) => c.isActive !== false), [categories]);
  const categoriaEfetiva = form.categoryId || categoriaDoFiltroId || "";
  const subcategoriasDaCategoria = useMemo(
    () => subcategories.filter((s) => s.categoryId === categoriaEfetiva && s.isActive !== false),
    [subcategories, categoriaEfetiva]
  );

  const nomes = {
    categoria: categories.find((c) => c.id === form.categoryId)?.name,
    subcategoria: subcategories.find((s) => s.id === form.subcategoryId)?.name,
    setor: sectors.find((s) => s.id === form.inventorySectorId)?.name,
    natureza: natures.find((n) => n.value === form.nature)?.label
  };

  function mudar(parcial: Partial<FormularioDoLote>) {
    setForm((atual) => ({ ...atual, ...parcial }));
    setResumo(null);
    setErro(null);
  }

  async function executar(aplicar: boolean) {
    setCarregando(true);
    setErro(null);
    try {
      const retorno = await organizarProdutosEmLote(alvo, mudancasDoFormulario(form), aplicar);
      if (aplicar) onAplicado(retorno);
      else setResumo(retorno);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível organizar os produtos.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <section className="lote-painel" aria-label="Organizar produtos selecionados">
      <div className="lote-cabecalho">
        <h3>Organizar {quantidade} produto{quantidade === 1 ? "" : "s"}</h3>
        <button type="button" className="secondary-button" onClick={onFechar} disabled={carregando}>Fechar</button>
      </div>
      <p className="lote-dica">Só o que você escolher muda. Campos em "Manter como está" ficam intactos. A categoria DRE não muda por aqui.</p>

      <div className="lote-campos">
        <label>
          Categoria
          <select value={form.categoryId} onChange={(e) => { setForm(comCategoria(form, e.target.value)); setResumo(null); }}>
            <option value={MANTER}>Manter como está</option>
            {categoriasAtivas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Subcategoria
          <select
            value={form.subcategoryId}
            onChange={(e) => mudar({ subcategoryId: e.target.value })}
            disabled={!categoriaEfetiva && form.subcategoryId !== LIMPAR}
            title={categoriaEfetiva ? undefined : "Escolha a categoria (ou filtre por ela) para ver as subcategorias"}
          >
            <option value={MANTER}>{form.categoryId ? "Deixar em branco (nova categoria)" : "Manter como está"}</option>
            <option value={LIMPAR}>Deixar em branco</option>
            {subcategoriasDaCategoria.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>
          Setor de contagem
          <select value={form.inventorySectorId} onChange={(e) => mudar({ inventorySectorId: e.target.value })}>
            <option value={MANTER}>Manter como está</option>
            <option value={LIMPAR}>Deixar sem setor</option>
            {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label>
          Natureza
          <select value={form.nature} onChange={(e) => mudar({ nature: e.target.value })}>
            <option value={MANTER}>Manter como está</option>
            {natures.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
          </select>
        </label>
        <label>
          Controla estoque
          <select value={form.controlsStock} onChange={(e) => mudar({ controlsStock: e.target.value as FormularioDoLote["controlsStock"] })}>
            <option value="">Manter como está</option>
            <option value="sim">Sim, entra na contagem</option>
            <option value="nao">Não, sai da contagem</option>
          </select>
        </label>
        <label>
          Situação
          <select value={form.isActive} onChange={(e) => mudar({ isActive: e.target.value as FormularioDoLote["isActive"] })}>
            <option value="">Manter como está</option>
            <option value="ativar">Ativar</option>
            <option value="inativar">Inativar</option>
          </select>
        </label>
      </div>

      {erro && <div className="alert error" role="alert">{erro}</div>}

      {!resumo && (
        <div className="lote-acoes">
          <button type="button" className="primary-button" disabled={!temMudanca(form) || carregando} onClick={() => void executar(false)}>
            {carregando ? "Conferindo..." : "Revisar mudanças"}
          </button>
        </div>
      )}

      {resumo && (
        <div className="lote-resumo" role="region" aria-label="Resumo do que vai mudar">
          <ul className="lote-mudancas">
            {descricaoDasMudancas(form, nomes).map((linha) => <li key={linha}>{linha}</li>)}
          </ul>
          <p>
            <strong>{resumo.alterar}</strong> produto{resumo.alterar === 1 ? "" : "s"} {resumo.alterar === 1 ? "será alterado" : "serão alterados"}
            {resumo.semMudanca > 0 && <> · {resumo.semMudanca} já {resumo.semMudanca === 1 ? "está" : "estão"} assim</>}
            {resumo.recusados > 0 && <> · <strong>{resumo.recusados}</strong> não {resumo.recusados === 1 ? "pode ser alterado" : "podem ser alterados"}</>}
          </p>
          {resumo.amostra.length > 0 && (
            <p className="lote-amostra">Por exemplo: {resumo.amostra.join(", ")}{resumo.alterar > resumo.amostra.length ? "…" : ""}</p>
          )}
          {resumo.recusadosPorMotivo.length > 0 && (
            <ul className="lote-recusas" aria-label="Produtos que não serão alterados">
              {resumo.recusadosPorMotivo.map((grupo) => (
                <li key={grupo.motivo}>
                  <strong>{grupo.count}</strong> não mudam: {grupo.motivo} <span className="lote-amostra">({grupo.exemplos.join(", ")}{grupo.count > grupo.exemplos.length ? "…" : ""})</span>
                </li>
              ))}
            </ul>
          )}
          {resumo.avisos.length > 0 && (
            <ul className="lote-avisos" aria-label="Avisos">
              {resumo.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}
            </ul>
          )}
          <div className="lote-acoes">
            <button type="button" className="primary-button" disabled={resumo.alterar === 0 || carregando} onClick={() => void executar(true)}>
              {carregando ? "Aplicando..." : `Aplicar em ${resumo.alterar} produto${resumo.alterar === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="secondary-button" disabled={carregando} onClick={() => setResumo(null)}>Voltar</button>
          </div>
          <p className="lote-dica">Depois de aplicar, você poderá desfazer. O desfazer devolve só quem ainda estiver como o lote deixou.</p>
        </div>
      )}
    </section>
  );
}
