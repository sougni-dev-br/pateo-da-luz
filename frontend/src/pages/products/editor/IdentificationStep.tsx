import { useState } from "react";
import type { StepProps } from "./types";

export function IdentificationStep({ editor, canCreateMasterData }: StepProps) {
  const { form, setForm, opcoes, opcaoDaNatureza, cadastroNovo, similares, alias, setAlias, escolherCategoria } = editor;
  const [novaCategoria, setNovaCategoria] = useState("");
  const [novaSubcategoria, setNovaSubcategoria] = useState("");
  const [falhaAoCriar, setFalhaAoCriar] = useState<string | null>(null);
  const fisico = opcaoDaNatureza ? opcaoDaNatureza.fisico : true;
  const subcategorias = opcoes.subcategories.filter((sub) => sub.categoryId === form.categoryId);

  async function criar(acao: () => Promise<void>, limpar: () => void) {
    setFalhaAoCriar(null);
    try {
      await acao();
      limpar();
    } catch (falha) {
      setFalhaAoCriar(falha instanceof Error ? falha.message : "Não foi possível criar o cadastro.");
    }
  }

  return (
    <section className="form-section" aria-labelledby="passo-identificacao">
      <div className="form-section-header">
        <h3 id="passo-identificacao">Identificação</h3>
        <span>Como o item aparece nas compras, na contagem e nos relatórios.</span>
      </div>
      <div className="form-grid">
        <label>
          Código
          <input className="locked-field" value={form.externalCode || "Gerado ao salvar"} readOnly title="Código automático e não editável" />
        </label>
        <label className="span-2">
          Nome do item
          <input
            data-autofocus
            value={form.name}
            onChange={(event) => setForm((atual) => ({ ...atual, name: event.target.value }))}
            placeholder="Como a equipe chama o item"
          />
        </label>
        {cadastroNovo && similares.length > 0 && (
          <div className="alert warning span-3" role="status">
            <div className="alert-corpo">
              <strong>Já existe algo parecido. Confira antes de cadastrar de novo:</strong>
              <ul className="similares-lista">
                {similares.map((item) => (
                  <li key={item.id}>{item.externalCode ? `${item.externalCode} · ` : ""}{item.name}{item.unit ? ` (${item.unit})` : ""}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        {fisico && (
          <>
            <label>
              Unidade
              <select
                value={form.unitMeasureId}
                onChange={(event) => {
                  const unidade = opcoes.units.find((item) => item.id === event.target.value);
                  setForm((atual) => ({ ...atual, unitMeasureId: event.target.value, unit: unidade?.code ?? "" }));
                }}
              >
                <option value="">Selecione</option>
                {opcoes.units.map((unidade) => <option key={unidade.id} value={unidade.id}>{unidade.code} - {unidade.name}</option>)}
              </select>
            </label>
            <label>
              Categoria
              <select value={form.categoryId} onChange={(event) => escolherCategoria(event.target.value)}>
                <option value="">Selecione</option>
                {opcoes.categories.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.name}</option>)}
              </select>
            </label>
            <label>
              Subcategoria
              <select
                value={form.subcategoryId}
                onChange={(event) => setForm((atual) => ({ ...atual, subcategoryId: event.target.value }))}
                disabled={!form.categoryId}
              >
                <option value="">Sem subcategoria</option>
                {subcategorias.map((sub) => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
              </select>
            </label>
            {canCreateMasterData && (
              <div className="criar-cadastro span-3">
                <div className="criar-linha">
                  <input
                    aria-label="Nome da nova categoria"
                    placeholder="Categoria não existe? Digite o nome para criar"
                    value={novaCategoria}
                    onChange={(event) => setNovaCategoria(event.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!novaCategoria.trim()}
                    onClick={() => criar(() => editor.criarCategoria(novaCategoria.trim()), () => setNovaCategoria(""))}
                  >
                    Criar categoria
                  </button>
                </div>
                <div className="criar-linha">
                  <input
                    aria-label="Nome da nova subcategoria"
                    placeholder={form.categoryId ? "Subcategoria não existe? Digite o nome para criar" : "Escolha a categoria para criar uma subcategoria"}
                    value={novaSubcategoria}
                    onChange={(event) => setNovaSubcategoria(event.target.value)}
                    disabled={!form.categoryId}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!novaSubcategoria.trim() || !form.categoryId}
                    onClick={() => criar(() => editor.criarSubcategoria(novaSubcategoria.trim()), () => setNovaSubcategoria(""))}
                  >
                    Criar subcategoria
                  </button>
                </div>
              </div>
            )}
            {falhaAoCriar && <div className="alert error span-3" role="alert">{falhaAoCriar}</div>}
          </>
        )}
        <label className="span-3">
          Apelido na nota do fornecedor (opcional)
          <input
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            placeholder="Como o fornecedor chama este item na nota"
          />
          <small className="field-hint">
            Reconhece o item quando a nota vem com outro nome. Ex.: "BATATA LAVADA" na nota encontra "BATATA".
          </small>
        </label>
      </div>
    </section>
  );
}
