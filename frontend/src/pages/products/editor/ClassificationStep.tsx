import { DRECategoryOptions } from "../../../components/DRECategoryOptions";
import { dreSugeridas } from "../natureza";
import type { StepProps } from "./types";

export function ClassificationStep({ editor }: StepProps) {
  const { form, setForm, opcoes, setores, opcaoDaNatureza, avisos } = editor;
  const fisico = opcaoDaNatureza ? opcaoDaNatureza.fisico : true;
  const sugeridas = dreSugeridas(opcaoDaNatureza, opcoes.dreCategories);
  const idsSugeridos = new Set(sugeridas.map((item) => item.id));
  const demais = opcoes.dreCategories.filter((item) => !idsSugeridos.has(item.id));

  return (
    <section className="form-section" aria-labelledby="passo-classificacao">
      <div className="form-section-header">
        <h3 id="passo-classificacao">Classificação</h3>
        <span>Já sugerida pela natureza. Confira e mude só se este item for exceção.</span>
      </div>
      {avisos.map((aviso) => <div key={aviso} className="alert warning" role="status">{aviso}</div>)}
      <div className="form-grid">
        <label className="span-2">
          Categoria DRE
          <select
            value={form.dreCategoryId}
            onChange={(event) => setForm((atual) => ({ ...atual, dreCategoryId: event.target.value }))}
          >
            <option value="">Selecione</option>
            {sugeridas.length > 0 && (
              <optgroup label={`Sugeridas para ${opcaoDaNatureza?.label.toLowerCase()}`}>
                {sugeridas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </optgroup>
            )}
            <DRECategoryOptions categories={sugeridas.length > 0 ? demais : opcoes.dreCategories} />
          </select>
          <small className="field-hint">Define onde o gasto cai no DRE e se compõe o CMV.</small>
        </label>
        {fisico && (
          <article className={`stock-control-card ${form.controlsStock ? "is-enabled" : "is-disabled"}`}>
            <div>
              <strong>Controla estoque</strong>
              <p>
                {form.controlsStock
                  ? "Entra na contagem e no inventário."
                  : "Fica fora da contagem. O gasto vai direto para despesa."}
              </p>
            </div>
            <label className="switch-label">
              <input
                type="checkbox"
                checked={form.controlsStock}
                onChange={(event) => setForm((atual) => ({
                  ...atual,
                  controlsStock: event.target.checked,
                  inventorySectorId: event.target.checked ? atual.inventorySectorId : ""
                }))}
              />
              <span>
                <strong>{form.controlsStock ? "Sim, entra na contagem" : "Não entra na contagem"}</strong>
                <small>Desligar tira o item da contagem operacional.</small>
              </span>
            </label>
          </article>
        )}
        {fisico && form.controlsStock && (
          <label>
            Setor da contagem
            <select
              value={form.inventorySectorId}
              onChange={(event) => setForm((atual) => ({ ...atual, inventorySectorId: event.target.value }))}
            >
              <option value="">Selecione</option>
              {setores.map((setor) => <option key={setor.id} value={setor.id}>{setor.name}</option>)}
            </select>
          </label>
        )}
      </div>
    </section>
  );
}
