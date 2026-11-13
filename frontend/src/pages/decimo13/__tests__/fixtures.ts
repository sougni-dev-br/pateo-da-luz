import type { Decimo13Calculo, Decimo13Linha, Decimo13LinhaClt, Decimo13Parcela } from "../../../api/client";

// Dados FICTÍCIOS (o repositório é público) no formato da prévia do 13º.
export const calculo: Decimo13Calculo = {
  ano: 2026, avos: 12, avosParcela1: 11, desde: "2026-01-01", salario: 2000, mediaParcela1: 100, mediaFinal: 120,
  parcela1: 1000, total: 2200, parcela2: 1200, vencimento1: "2026-11-30", vencimento2: "2026-12-20", memoria: "",
};

export const parcela = (over: Partial<Decimo13Parcela> = {}): Decimo13Parcela => ({ existe: false, paga: false, lancado: null, devido: 1000, gerar: true, ...over });
/** Título já lançado: não há o que gerar, a não ser que o valor tenha mudado. */
export const lancada = (valor: number, over: Partial<Decimo13Parcela> = {}): Decimo13Parcela => ({ existe: true, paga: false, lancado: valor, devido: valor, gerar: false, ...over });

export const linhaSr = (over: Partial<Decimo13Linha> = {}): Decimo13Linha => ({
  employeeId: "s1", nome: "Ana Exemplo", setor: null, calculo, motivoSemCalculo: null,
  p1: parcela({ devido: 1000 }), p2: { ...parcela({ devido: 1200 }), excesso: 0 }, acerto: null,
  preRegistro: false, semRegistroAte: null, registroEm: null, ...over,
});

export const linhaClt = (over: Partial<Decimo13LinhaClt> = {}): Decimo13LinhaClt => ({
  employeeId: "c1", nome: "CARLOS EXEMPLO", setor: null, parcela1: null, parcela2: null, ...over,
});
