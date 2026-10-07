import { describe, expect, test } from "vitest";
import {
  classificarItemDaConferencia,
  ordenarConferencia,
  resumirConferencia,
  type EntradaConferencia
} from "../conferencia.js";

// Os casos com nome de produto saem do inventario real de 31/07/2026
// (INV-2026-0021) comparado ao de 29/06/2026 (INV-2026-0020).

const semHistorico = { mediana: null, menor: null, maior: null, observacoes: 0 };

function entrada(parcial: Partial<EntradaConferencia>): EntradaConferencia {
  return {
    nomeProduto: "PRODUTO",
    unidade: "UN",
    contado: 10,
    anterior: 10,
    compras: 0,
    custoUnitario: 1,
    historico: semHistorico,
    ...parcial
  };
}

describe("classificarItemDaConferencia", () => {
  test("sem quantidade lancada fica pendente", () => {
    const r = classificarItemDaConferencia(entrada({ contado: null }));
    expect(r.classe).toBe("PENDENTE");
    expect(r.impacto).toBeNull();
  });

  test("sem contagem anterior aprovada nao tem como conferir", () => {
    const r = classificarItemDaConferencia(entrada({ anterior: null, contado: 5, custoUnitario: 2 }));
    expect(r.classe).toBe("SEM_REFERENCIA");
    expect(r.disponivel).toBeNull();
    expect(r.impacto).toBe(10);
  });

  test("contou mais do que havia: impossivel, com a sobra sem origem", () => {
    // MEXEDOR CAFE GOLDEN C/ 500: tinha 2 pacotes, nenhuma compra, contou 420.
    const r = classificarItemDaConferencia(entrada({
      nomeProduto: "MEXEDOR CAFÉ GOLDEN C/ 500", unidade: "PCTE",
      anterior: 2, compras: 0, contado: 420, custoUnitario: 5
    }));
    expect(r.classe).toBe("IMPOSSIVEL");
    expect(r.disponivel).toBe(2);
    expect(r.impacto).toBe(2090); // (420 - 2) * 5
    expect(r.motivo).toContain("418");
    expect(r.motivo).toContain("embalagem com 500");
    expect(r.motivo).toContain("em vez de pacotes");
  });

  test("impossivel sem compra no periodo sugere compra nao lancada", () => {
    const r = classificarItemDaConferencia(entrada({ nomeProduto: "VINHO TINTO 750ML", anterior: 2, compras: 0, contado: 7 }));
    expect(r.classe).toBe("IMPOSSIVEL");
    expect(r.motivo).toMatch(/nenhuma compra/i);
  });

  test("pequena sobra dentro da tolerancia de pesagem nao acusa", () => {
    // 10 kg disponiveis, contou 10,3 kg: diferenca de balanca, nao erro.
    const r = classificarItemDaConferencia(entrada({ unidade: "KG", anterior: 4, compras: 6, contado: 10.3 }));
    expect(r.classe).not.toBe("IMPOSSIVEL");
  });

  test("zerado tendo entrada no periodo e suspeito, e o impacto e o que havia", () => {
    // ALCATRA: 4,01 kg em 29/06 + 441,62 kg comprados em julho, contado 0.
    const r = classificarItemDaConferencia(entrada({
      nomeProduto: "ALCATRA", unidade: "KG", anterior: 4.01, compras: 441.62, contado: 0, custoUnitario: 45
    }));
    expect(r.classe).toBe("ZERADO_SUSPEITO");
    expect(r.impacto).toBeCloseTo(445.63 * 45, 2);
    expect(r.motivo).toContain("441,62");
  });

  test("zerar o que sobrou, sem compra no periodo, e consumo normal", () => {
    // Tinha 5, ninguem comprou, acabou: nao e erro de contagem.
    const r = classificarItemDaConferencia(entrada({ unidade: "KG", anterior: 5, compras: 0, contado: 0 }));
    expect(r.classe).toBe("COERENTE");
    expect(r.motivo).toContain("Consumiu os 5 KG");
  });

  test("zerado sem nada disponivel e coerente", () => {
    const r = classificarItemDaConferencia(entrada({ anterior: 0, compras: 0, contado: 0 }));
    expect(r.classe).toBe("COERENTE");
  });

  test("consumo normal e coerente e o impacto e o valor consumido", () => {
    // FILE MIGNON: 43,74 + 81,62 - 22 = 103,36 kg consumidos.
    const r = classificarItemDaConferencia(entrada({
      nomeProduto: "FILE MIGNON", unidade: "KG", anterior: 43.74, compras: 81.62, contado: 22, custoUnitario: 80
    }));
    expect(r.classe).toBe("COERENTE");
    expect(r.consumo).toBeCloseTo(103.36, 3);
    expect(r.impacto).toBeCloseTo(103.36 * 80, 2);
  });

  test("muito acima de tudo que ja foi contado sai do historico", () => {
    const r = classificarItemDaConferencia(entrada({
      anterior: 10, compras: 200, contado: 150,
      historico: { mediana: 12, menor: 8, maior: 20, observacoes: 4 }
    }));
    expect(r.classe).toBe("FORA_DO_HISTORICO");
    expect(r.motivo).toContain("20");
  });

  test("muito abaixo da mediana sai do historico", () => {
    const r = classificarItemDaConferencia(entrada({
      anterior: 50, compras: 0, contado: 2,
      historico: { mediana: 40, menor: 30, maior: 60, observacoes: 5 }
    }));
    expect(r.classe).toBe("FORA_DO_HISTORICO");
  });

  test("historico com uma contagem so nao serve de base", () => {
    const r = classificarItemDaConferencia(entrada({
      anterior: 10, compras: 200, contado: 150,
      historico: { mediana: 12, menor: 12, maior: 12, observacoes: 1 }
    }));
    expect(r.classe).toBe("COERENTE");
  });

  test("historico erratico (20x entre menor e maior) nao serve de base", () => {
    // O caso do PALITO C/2000: contagens de 0,7 a 1800.
    const r = classificarItemDaConferencia(entrada({
      anterior: 10, compras: 200, contado: 150,
      historico: { mediana: 12, menor: 1, maior: 40, observacoes: 4 }
    }));
    expect(r.classe).toBe("COERENTE");
  });

  test("sem custo o item continua classificado, so sem impacto", () => {
    const r = classificarItemDaConferencia(entrada({ anterior: 2, contado: 9, custoUnitario: null }));
    expect(r.classe).toBe("IMPOSSIVEL");
    expect(r.impacto).toBeNull();
  });
});

describe("ordenarConferencia", () => {
  test("gravidade primeiro, depois o maior impacto", () => {
    const itens = [
      { id: "coerente", classe: "COERENTE" as const, impacto: 9999 },
      { id: "zerado-pequeno", classe: "ZERADO_SUSPEITO" as const, impacto: 10 },
      { id: "impossivel", classe: "IMPOSSIVEL" as const, impacto: 1 },
      { id: "zerado-grande", classe: "ZERADO_SUSPEITO" as const, impacto: 500 },
      { id: "zerado-sem-custo", classe: "ZERADO_SUSPEITO" as const, impacto: null }
    ];
    expect(ordenarConferencia(itens).map((i) => i.id)).toEqual([
      "impossivel", "zerado-grande", "zerado-pequeno", "zerado-sem-custo", "coerente"
    ]);
  });

  test("nao altera a lista recebida", () => {
    const itens = [
      { classe: "COERENTE" as const, impacto: 1 },
      { classe: "IMPOSSIVEL" as const, impacto: 1 }
    ];
    ordenarConferencia(itens);
    expect(itens[0].classe).toBe("COERENTE");
  });
});

describe("resumirConferencia", () => {
  test("conta itens e soma impacto por classe, todas as classes presentes", () => {
    const resumo = resumirConferencia([
      { classe: "IMPOSSIVEL", impacto: 10 },
      { classe: "IMPOSSIVEL", impacto: null },
      { classe: "COERENTE", impacto: 5 }
    ]);
    expect(resumo.IMPOSSIVEL).toEqual({ itens: 2, impacto: 10 });
    expect(resumo.COERENTE).toEqual({ itens: 1, impacto: 5 });
    expect(resumo.ZERADO_SUSPEITO).toEqual({ itens: 0, impacto: 0 });
  });
});
