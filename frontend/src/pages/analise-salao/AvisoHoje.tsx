// O servidor deixa o dia em andamento de fora (só com o almoço lançado, "hoje" entraria como um dia
// fraco e derrubaria médias e comparações). A tela diz isso, em vez de deixar o período parecer
// mais curto sem explicação.
export function AvisoHoje({ ativo }: { ativo: boolean }) {
  if (!ativo) return null;
  return <p className="analise-nota">Hoje fica de fora: o dia ainda não fechou e distorceria as médias por dia.</p>;
}
