import type { StepProps } from "./types";

export function NatureStep({ editor }: StepProps) {
  const { natures, form, cadastroNovo, escolherNatureza } = editor;

  return (
    <section className="form-section" aria-labelledby="passo-natureza">
      <div className="form-section-header">
        <h3 id="passo-natureza">O que é este item?</h3>
        <span>
          A resposta preenche o resto: se entra no CMV, se controla estoque e quais campos aparecem.
        </span>
      </div>
      {!cadastroNovo && !form.nature && (
        <div className="alert info">
          Este produto foi cadastrado antes da natureza existir. Escolher é opcional; ao escolher, o cadastro passa a exigir
          unidade, categoria, categoria DRE e, se controlar estoque, setor.
        </div>
      )}
      {natures.length === 0 && (
        <div className="alert warning">
          O servidor ainda não informou as naturezas do item. Atualize a página; se continuar, avise o suporte.
        </div>
      )}
      {/* Radios de verdade: Tab entra no grupo, setas trocam de opção, leitor de tela anuncia "1 de 5". */}
      <fieldset className="natureza-grid">
        <legend className="sr-only">Natureza do item</legend>
        {natures.map((opcao) => {
          const marcada = form.nature === opcao.value;
          return (
            <label key={opcao.value} className={`natureza-card${marcada ? " is-selected" : ""}`}>
              <input
                type="radio"
                name="natureza-do-item"
                value={opcao.value}
                checked={marcada}
                onChange={() => escolherNatureza(opcao.value)}
              />
              <strong>{opcao.label}</strong>
              <span>{opcao.description}</span>
              <small>
                {opcao.entraNoCmv ? "Entra no CMV" : "Despesa, fora do CMV"}
                {" · "}
                {opcao.fisico ? (opcao.controlsStock ? "controla estoque" : "sem estoque") : "sem estoque nem unidade"}
              </small>
            </label>
          );
        })}
      </fieldset>
    </section>
  );
}
