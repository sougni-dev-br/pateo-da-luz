import { describe, expect, test } from "vitest";
import { chaveDoEvento, nomeDaSerie, nomeLimpo } from "../eventos-nome.js";
import { posicaoNoEvento, preverAlmoco, tamanhoPara, type DiaHistorico, type EventoNoDia } from "../eventos-previsao.js";

// Séries fictícias: o repositório é público.
const feira = (posicao: EventoNoDia["posicao"]): EventoNoDia => ({ seriesId: "s-feira", seriesName: "Feira de Exemplo", origin: "CENTRO_CONVENCOES", posicao });
const congresso = (posicao: EventoNoDia["posicao"]): EventoNoDia => ({ seriesId: "s-congresso", seriesName: "Congresso Fictício", origin: "CENTRO_CONVENCOES", posicao });
const grupo: EventoNoDia = { seriesId: "s-grupo", seriesName: "Grupo com pacote", origin: "GRUPO", posicao: "UNICO" };
const limites = { smallMaxLunch: 80, largeMinLunch: 150 };

describe("chave do evento", () => {
  test("junta as variações de nome da mesma série", () => {
    const chave = chaveDoEvento("Congresso Brasileiro de Exemplo");
    expect(chaveDoEvento("23º CONGRESSO BRASILEIRO DE EXEMPLO - EVENTO DA ÁREA MÉDICA")).toBe(chave);
    expect(chaveDoEvento("Congres Bras de Exemplo (CBE)")).toBe(chave);
    expect(chaveDoEvento("XXI Congresso Brasileiro de Exemplo 2025")).toBe(chave);
  });

  test("edição e ano colados no nome saem da chave", () => {
    expect(chaveDoEvento("107ª Feira Fictícia")).toBe(chaveDoEvento("Feira Fictícia"));
    expect(chaveDoEvento("Pré - EXEMPLO2025")).toBe(chaveDoEvento("EXEMPLO2025"));
  });

  test("pré-congresso cai na mesma série do congresso", () => {
    expect(chaveDoEvento("PRE-CONGRESSO - 16º CONGRESSO PAULISTA DE EXEMPLO")).toBe(chaveDoEvento("16º Congresso Paulista de Exemplo"));
  });

  test("nome limpo tira só o ano do fim", () => {
    expect(nomeLimpo("Feira  Fictícia   2026")).toBe("Feira Fictícia");
  });

  test("nome da série tira o número da edição", () => {
    expect(nomeDaSerie("17º Fórum de Exemplo 2025")).toBe("Fórum de Exemplo");
    expect(nomeDaSerie("XXI Encontro Fictício")).toBe("Encontro Fictício");
    expect(nomeDaSerie("107ª Feira")).toBe("Feira");
    expect(nomeDaSerie("Feira Fictícia")).toBe("Feira Fictícia");
  });
});

describe("posição e tamanho", () => {
  test("posição do dia dentro do evento", () => {
    expect(posicaoNoEvento(0, 1)).toBe("UNICO");
    expect(posicaoNoEvento(0, 3)).toBe("PRIMEIRO");
    expect(posicaoNoEvento(1, 3)).toBe("MEIO");
    expect(posicaoNoEvento(2, 3)).toBe("ULTIMO");
  });

  test("limites: até 80 é Pequeno, acima de 150 é Grande", () => {
    expect(tamanhoPara(80, limites)).toBe("PEQUENO");
    expect(tamanhoPara(81, limites)).toBe("MEDIO");
    expect(tamanhoPara(150, limites)).toBe("MEDIO");
    expect(tamanhoPara(151, limites)).toBe("GRANDE");
  });
});

describe("previsão de almoços", () => {
  // Dias úteis de 2025 (06/01 é segunda).
  const historico: DiaHistorico[] = [
    { date: "2025-01-06", lunch: 120, eventos: [feira("PRIMEIRO")] },
    { date: "2025-01-07", lunch: 200, eventos: [feira("MEIO")] },
    { date: "2025-01-08", lunch: 90, eventos: [feira("ULTIMO")] },
    { date: "2025-02-03", lunch: 60, eventos: [congresso("PRIMEIRO")] },
    { date: "2025-02-04", lunch: 140, eventos: [congresso("MEIO")] },
    { date: "2025-02-05", lunch: 150, eventos: [congresso("MEIO")] },
    { date: "2025-02-06", lunch: 70, eventos: [congresso("ULTIMO")] },
    { date: "2025-03-10", lunch: 30, eventos: [] },
  ];

  test("dia sem evento não tem previsão", () => {
    expect(preverAlmoco({ date: "2026-01-07", eventos: [] }, historico, limites)).toBeNull();
  });

  test("usa a mesma série no mesmo ponto do evento e explica de onde veio", () => {
    const p = preverAlmoco({ date: "2026-01-06", eventos: [feira("MEIO")] }, historico, limites)!;
    // série: 200 (1 dia) · perfil "dia do meio, dia útil, 1 evento": 200, 140, 150 → 150. Peso meio a meio.
    expect(p.almoco).toBe(175);
    expect(p.tamanho).toBe("GRANDE");
    expect(p.base).toMatch(/Em edições anteriores, Feira de Exemplo teve 200 almoços no dia do meio \(1 dia\)/);
    expect(p.base).toMatch(/dias parecidos com este \(dia do meio, dia útil, 1 evento\) tiveram 150 almoços \(3 dias\)/);
    expect(p.minimo).toBeLessThanOrEqual(p.almoco);
    expect(p.maximo).toBeGreaterThanOrEqual(p.almoco);
  });

  test("série nova cai no perfil de dias parecidos", () => {
    const novo: EventoNoDia = { seriesId: "s-novo", seriesName: "Evento Novo", origin: "CENTRO_CONVENCOES", posicao: "ULTIMO" };
    const p = preverAlmoco({ date: "2026-01-08", eventos: [novo] }, historico, limites)!;
    expect(p.base).not.toMatch(/Evento Novo/);
    // Só 2 últimos dias em dia útil (90 e 70): ainda valem mais que a média de todos os dias.
    expect(p.almoco).toBe(80);
    expect(p.tamanho).toBe("PEQUENO");
    expect(p.poucaBase).toBe(true);
  });

  test("não olha para o futuro: só conta o que aconteceu antes do dia", () => {
    const p = preverAlmoco({ date: "2025-01-07", eventos: [feira("MEIO")] }, historico, limites)!;
    expect(p.base).not.toMatch(/teve 200 almoços/);
  });

  test("com dois eventos fica com a série que mais rende", () => {
    const p = preverAlmoco({ date: "2026-02-04", eventos: [feira("MEIO"), congresso("MEIO")] }, historico, limites)!;
    expect(p.base).toMatch(/^Em edições anteriores, Feira de Exemplo/);
  });

  test("grupo com pacote não conta como evento do prédio no perfil", () => {
    const comGrupo: DiaHistorico[] = [...historico, { date: "2025-03-11", lunch: 300, eventos: [grupo] }];
    const p = preverAlmoco({ date: "2026-01-08", eventos: [feira("ULTIMO")] }, comGrupo, limites)!;
    expect(p.base).not.toMatch(/300/);
  });

  test("avisa quando há pouca base", () => {
    const curto: DiaHistorico[] = [{ date: "2025-01-06", lunch: 100, eventos: [congresso("PRIMEIRO")] }];
    const novo: EventoNoDia = { seriesId: "s-novo", seriesName: "Evento Novo", origin: "CENTRO_CONVENCOES", posicao: "PRIMEIRO" };
    const p = preverAlmoco({ date: "2026-01-06", eventos: [novo] }, curto, limites)!;
    expect(p.poucaBase).toBe(true);
    expect(p.casos).toBe(1);
  });
});
