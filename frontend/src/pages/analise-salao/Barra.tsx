// Barra horizontal simples, proporcional ao maior valor da coluna. Decorativa: o número
// ao lado é a informação, por isso fica fora da árvore de acessibilidade.
export function Barra({ razao, tom = "neutro" }: { razao: number; tom?: "neutro" | "perigo" }) {
  const largura = Math.max(0, Math.min(1, razao)) * 100;
  return (
    <span className="analise-barra" aria-hidden="true">
      <span className={`analise-barra-preenchimento analise-barra-${tom}`} style={{ width: `${largura}%` }} />
    </span>
  );
}
