import { STEP_LABELS } from "../natureza";
import type { StepProps } from "./types";

export function ReviewStep({ editor }: StepProps) {
  const { form, setForm, opcoes, setores, opcaoDaNatureza, pendencias, avisos, rigido, setPasso } = editor;
  const fisico = opcaoDaNatureza ? opcaoDaNatureza.fisico : true;
  const categoria = opcoes.categories.find((item) => item.id === form.categoryId)?.name;
  const dre = opcoes.dreCategories.find((item) => item.id === form.dreCategoryId)?.name;
  const setor = setores.find((item) => item.id === form.inventorySectorId)?.name;

  const linhas: Array<{ rotulo: string; valor: string | undefined; ver?: boolean }> = [
    { rotulo: "Natureza", valor: opcaoDaNatureza?.label ?? "Não definida" },
    { rotulo: "Nome", valor: form.name.trim() },
    ...(fisico ? [
      { rotulo: "Unidade", valor: form.unit },
      { rotulo: "Categoria", valor: categoria }
    ] : []),
    { rotulo: "Categoria DRE", valor: dre },
    ...(fisico ? [{ rotulo: "Controla estoque", valor: form.controlsStock ? "Sim, entra na contagem" : "Não" }] : []),
    ...(fisico && form.controlsStock ? [{ rotulo: "Setor da contagem", valor: setor }] : [])
  ];

  return (
    <section className="form-section" aria-labelledby="passo-conferencia">
      <div className="form-section-header">
        <h3 id="passo-conferencia">Conferência</h3>
        <span>Veja o que será gravado. Salvar só libera quando não houver pendência.</span>
      </div>

      {pendencias.length > 0 && (
        <div className={`alert ${rigido ? "warning" : "info"}`} role="status">
          <strong>{rigido ? "Falta preencher:" : "Cadastro antigo, ainda incompleto (não bloqueia):"}</strong>
          <ul className="similares-lista">
            {pendencias.map((pendencia) => (
              <li key={`${pendencia.step}-${pendencia.campo}`}>
                {pendencia.campo}{" "}
                <button type="button" className="link-button" onClick={() => setPasso(pendencia.step)}>
                  ir para {STEP_LABELS[pendencia.step].toLowerCase()}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {avisos.map((aviso) => <div key={aviso} className="alert warning" role="status">{aviso}</div>)}

      <dl className="conferencia-lista">
        {linhas.map((linha) => (
          <div key={linha.rotulo} className="conferencia-linha">
            <dt>{linha.rotulo}</dt>
            <dd>{linha.valor || <span className="cell-pendente">pendente</span>}</dd>
          </div>
        ))}
      </dl>

      <div className="form-grid">
        <label className="span-3">
          Observações (opcional)
          <input value={form.notes} onChange={(event) => setForm((atual) => ({ ...atual, notes: event.target.value }))} />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(event) => setForm((atual) => ({ ...atual, isActive: event.target.checked }))}
          />
          Produto ativo
        </label>
      </div>
    </section>
  );
}
