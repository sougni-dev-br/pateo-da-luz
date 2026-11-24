// Esqueleto de carregamento com o formato do que vai aparecer (veredito + tabela), para a tela não pular.

export function Esqueleto({ rotulo }: { rotulo: string }) {
  return (
    <div className="plan-esqueleto" role="status" aria-live="polite">
      <span className="plan-sr">{rotulo}</span>
      <div className="plan-esqueleto-bloco plan-esqueleto-alto" aria-hidden />
      <div className="plan-esqueleto-linha" aria-hidden>
        <span className="plan-esqueleto-bloco" />
        <span className="plan-esqueleto-bloco" />
        <span className="plan-esqueleto-bloco" />
      </div>
      <div className="plan-esqueleto-bloco plan-esqueleto-tabela" aria-hidden />
    </div>
  );
}
