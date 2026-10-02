// Gorjeta informada à contabilidade pelo teto do IR (CLT).
//
// A empresa informa à contabilidade só a gorjeta que deixa o total registrado no teto de
// isenção do IR: teto − salário registrado — mas nunca mais do que a gorjeta real da
// pessoa (sem gorjeta real, informa zero). A pessoa continua recebendo a gorjeta dos
// pontos (folha de líquidos e lista de pagamento não mudam). Sem teto, ou sem salário
// registrado para descontar, vai a gorjeta do rateio, como sempre foi.

const round2 = (v: number) => Math.round(v * 100) / 100;

export function gorjetaInformada(teto: number | null, salarioRegistrado: number | null, gorjetaReal: number): number {
  if (teto == null || salarioRegistrado == null) return gorjetaReal;
  const real = Number.isFinite(gorjetaReal) ? Math.max(0, round2(gorjetaReal)) : 0;
  return Math.min(real, Math.max(0, round2(teto - salarioRegistrado)));
}
