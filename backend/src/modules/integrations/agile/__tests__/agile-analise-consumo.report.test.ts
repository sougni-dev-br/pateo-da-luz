import { describe, expect, it } from "vitest";
import {
  montarConsumoTeorico,
  type FichaDoPrato,
  type VendaPorProduto,
  type VinculoDeInsumo
} from "../agile-analise-consumo.report.js";

const PERIODO = { inicio: "2026-09-01", fim: "2026-09-30" };

const venda = (p: Partial<VendaPorProduto> & Pick<VendaPorProduto, "codigo" | "nome">): VendaPorProduto => ({
  categoria: "PRATOS",
  quantidade: 10,
  valor: 500,
  ...p
});

const FILE: FichaDoPrato = {
  id: "d1",
  nome: "Filé com fritas",
  rendimento: 1,
  unidadeRendimento: "UN",
  rendimentoEmPorcao: true,
  itens: [
    { insumoId: "p-file", insumo: "Filé mignon", quantidade: 200, unidade: "G", perda: 0.1, unidadeEstoque: "KG", conversoes: [] },
    { insumoId: "p-batata", insumo: "Batata", quantidade: 0.15, unidade: "KG", perda: 0, unidadeEstoque: "KG", conversoes: [] }
  ]
};

const CERVEJA: VinculoDeInsumo = {
  codigo: "C1", insumoId: "p-cerveja", insumo: "Cerveja long neck", quantidade: 1, unidade: "UN", unidadeEstoque: "UN", conversoes: []
};

function montar(over: Partial<Parameters<typeof montarConsumoTeorico>[0]> = {}) {
  return montarConsumoTeorico({
    periodo: PERIODO,
    vendas: [],
    fichas: [FILE],
    vinculosPrato: [],
    vinculosInsumo: [],
    ...over
  });
}

describe("montarConsumoTeorico", () => {
  it("devolve vazio sem vendas", () => {
    const r = montar();
    expect(r.insumos).toEqual([]);
    expect(r.cobertura.receitaTotal).toBe(0);
    expect(r.cobertura.pct).toBe(0);
  });

  it("prato vendido consome a ficha por porcao, com perda e conversao para a unidade de estoque", () => {
    const r = montar({
      vendas: [venda({ codigo: "P1", nome: "FILE COM FRITAS", quantidade: 10 })],
      vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
    });
    const file = r.insumos.find((i) => i.insumoId === "p-file");
    const batata = r.insumos.find((i) => i.insumoId === "p-batata");
    // 10 porcoes x 200 G x 1,1 de perda = 2.200 G = 2,2 KG
    expect(file).toMatchObject({ unidade: "KG", consumo: 2.2 });
    expect(batata).toMatchObject({ unidade: "KG", consumo: 1.5 });
  });

  it("divide a ficha pelo rendimento", () => {
    const r = montar({
      fichas: [{ ...FILE, rendimento: 4 }],
      vendas: [venda({ codigo: "P1", nome: "FILE", quantidade: 8 })],
      vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
    });
    // ficha rende 4 porcoes: 8 vendidas = 2 receitas, 200 G x 1,1 x 2 = 440 G
    expect(r.insumos.find((i) => i.insumoId === "p-file")?.consumo).toBe(0.44);
  });

  it("soma varios produtos do PDV que apontam para o mesmo prato", () => {
    const r = montar({
      vendas: [venda({ codigo: "P1", nome: "FILE", quantidade: 3 }), venda({ codigo: "P2", nome: "FILE PROMO", quantidade: 2 })],
      vinculosPrato: [{ codigo: "P1", pratoId: "d1" }, { codigo: "P2", pratoId: "d1" }]
    });
    expect(r.insumos.find((i) => i.insumoId === "p-batata")?.consumo).toBe(0.75);
  });

  it("soma o mesmo insumo vindo de pratos e de bebida de revenda", () => {
    const r = montar({
      fichas: [{ ...FILE, itens: [{ insumoId: "p-cerveja", insumo: "Cerveja long neck", quantidade: 1, unidade: "UN", perda: 0, unidadeEstoque: "UN", conversoes: [] }] }],
      vendas: [venda({ codigo: "P1", nome: "PRATO COM CERVEJA", quantidade: 2 }), venda({ codigo: "C1", nome: "CERVEJA", categoria: "BEBIDAS", quantidade: 5 })],
      vinculosPrato: [{ codigo: "P1", pratoId: "d1" }],
      vinculosInsumo: [CERVEJA]
    });
    expect(r.insumos.find((i) => i.insumoId === "p-cerveja")?.consumo).toBe(7);
  });

  it("bebida de revenda consome a quantidade do vinculo na unidade de estoque", () => {
    const r = montar({
      vendas: [venda({ codigo: "C1", nome: "CHOPE", categoria: "BEBIDAS", quantidade: 20 })],
      vinculosInsumo: [{ ...CERVEJA, insumoId: "p-chope", insumo: "Chope", quantidade: 300, unidade: "ML", unidadeEstoque: "L" }]
    });
    // 20 x 300 ML = 6.000 ML = 6 L
    expect(r.insumos.find((i) => i.insumoId === "p-chope")).toMatchObject({ unidade: "L", consumo: 6 });
  });

  it("usa a conversao cadastrada no produto antes da universal", () => {
    const r = montar({
      vendas: [venda({ codigo: "C1", nome: "CERVEJA", categoria: "BEBIDAS", quantidade: 12 })],
      vinculosInsumo: [{ ...CERVEJA, unidade: "UN", unidadeEstoque: "CX", conversoes: [{ fromUnit: "CX", toUnit: "UN", factor: 12 }] }]
    });
    expect(r.insumos.find((i) => i.insumoId === "p-cerveja")).toMatchObject({ unidade: "CX", consumo: 1 });
  });

  it("produto com vinculo de prato nao conta tambem como insumo", () => {
    const r = montar({
      fichas: [{ ...FILE, itens: [] }],
      vendas: [venda({ codigo: "C1", nome: "CERVEJA", categoria: "BEBIDAS", quantidade: 5 })],
      vinculosPrato: [{ codigo: "C1", pratoId: "d1" }],
      vinculosInsumo: [CERVEJA]
    });
    expect(r.insumos.find((i) => i.insumoId === "p-cerveja")).toBeUndefined();
  });

  describe("problemas", () => {
    it("item de ficha sem conversao de unidade fica de fora e vira problema, sem derrubar o resto", () => {
      const r = montar({
        fichas: [{ ...FILE, itens: [...FILE.itens, { insumoId: "p-molho", insumo: "Molho", quantidade: 2, unidade: "CX", perda: 0, unidadeEstoque: "KG", conversoes: [] }] }],
        vendas: [venda({ codigo: "P1", nome: "FILE", quantidade: 10 })],
        vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
      });
      expect(r.insumos.find((i) => i.insumoId === "p-molho")).toBeUndefined();
      expect(r.insumos.find((i) => i.insumoId === "p-file")).toBeDefined();
      expect(r.problemas).toContainEqual(expect.objectContaining({ tipo: "SEM_CONVERSAO", insumo: "Molho", origem: "Filé com fritas" }));
    });

    it("ficha com rendimento que nao e porcao nao entra, porque cada venda nao e uma porcao", () => {
      const r = montar({
        fichas: [{ ...FILE, rendimentoEmPorcao: false }],
        vendas: [venda({ codigo: "P1", nome: "FILE", quantidade: 10 })],
        vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
      });
      expect(r.insumos).toEqual([]);
      expect(r.problemas).toContainEqual(expect.objectContaining({ tipo: "RENDIMENTO_NAO_E_PORCAO", origem: "Filé com fritas" }));
    });

    it("vinculo para prato que nao existe mais vira problema e nao conta como coberto", () => {
      const r = montar({
        vendas: [venda({ codigo: "P9", nome: "PRATO SUMIDO", valor: 400 })],
        vinculosPrato: [{ codigo: "P9", pratoId: "inexistente" }]
      });
      expect(r.cobertura.receitaCoberta).toBe(0);
      expect(r.problemas).toContainEqual(expect.objectContaining({ tipo: "PRATO_INDISPONIVEL" }));
    });

    it("ficha sem itens nao conta como coberta", () => {
      const r = montar({
        fichas: [{ ...FILE, itens: [] }],
        vendas: [venda({ codigo: "P1", nome: "FILE", valor: 300 })],
        vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
      });
      expect(r.cobertura.receitaCoberta).toBe(0);
      expect(r.semVinculo[0]).toMatchObject({ codigo: "P1", motivo: "FICHA_SEM_ITENS" });
    });
  });

  describe("ficha incompleta nao conta como coberta", () => {
    it("prato com ingrediente sem conversao fica fora da cobertura, mas o consumo que deu para calcular continua", () => {
      const r = montar({
        fichas: [{ ...FILE, itens: [...FILE.itens, { insumoId: "p-molho", insumo: "Molho", quantidade: 2, unidade: "CX", perda: 0, unidadeEstoque: "KG", conversoes: [] }] }],
        vendas: [venda({ codigo: "P1", nome: "FILE", quantidade: 10, valor: 700 })],
        vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
      });
      expect(r.cobertura).toMatchObject({ receitaTotal: 700, receitaCoberta: 0, pct: 0 });
      expect(r.semVinculo[0]).toMatchObject({ codigo: "P1", motivo: "FICHA_INCOMPLETA", receita: 700 });
      // piso: o que deu para calcular continua somado
      expect(r.insumos.find((i) => i.insumoId === "p-file")?.consumo).toBe(2.2);
    });

    it("prato com todos os itens descartados nao conta como coberto", () => {
      const r = montar({
        fichas: [{ ...FILE, itens: [{ insumoId: "p-molho", insumo: "Molho", quantidade: 2, unidade: "CX", perda: 0, unidadeEstoque: "KG", conversoes: [] }] }],
        vendas: [venda({ codigo: "P1", nome: "FILE", valor: 300 })],
        vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
      });
      expect(r.cobertura.receitaCoberta).toBe(0);
      expect(r.semVinculo[0]).toMatchObject({ motivo: "FICHA_INCOMPLETA" });
    });

    it("ficha de producao que falta na hora de expandir deixa o prato incompleto", () => {
      const r = montar({
        fichas: [{ ...FILE, itens: [{ componenteId: "sumiu", quantidade: 1, unidade: "KG", perda: 0 }] }],
        vendas: [venda({ codigo: "P1", nome: "FILE", valor: 300 })],
        vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
      });
      expect(r.cobertura.receitaCoberta).toBe(0);
      expect(r.semVinculo[0]).toMatchObject({ motivo: "FICHA_INCOMPLETA" });
    });

    it("ciclo em ficha de producao deixa o prato incompleto", () => {
      const A: FichaDoPrato = { id: "a", nome: "A", rendimento: 1, unidadeRendimento: "KG", rendimentoEmPorcao: false, itens: [{ componenteId: "a", quantidade: 1, unidade: "KG", perda: 0 }] };
      const prato: FichaDoPrato = { ...FILE, itens: [{ componenteId: "a", quantidade: 1, unidade: "KG", perda: 0 }] };
      const r = montar({ fichas: [prato, A], vendas: [venda({ codigo: "P1", nome: "FILE", valor: 300 })], vinculosPrato: [{ codigo: "P1", pratoId: "d1" }] });
      expect(r.cobertura.receitaCoberta).toBe(0);
    });

    it("ficha-filha incompleta tambem deixa o prato incompleto", () => {
      const MASSA: FichaDoPrato = { id: "massa", nome: "Massa", rendimento: 10, unidadeRendimento: "KG", rendimentoEmPorcao: false, itens: [{ insumoId: "p-x", insumo: "X", quantidade: 1, unidade: "CX", perda: 0, unidadeEstoque: "KG", conversoes: [] }] };
      const prato: FichaDoPrato = { ...FILE, itens: [{ componenteId: "massa", quantidade: 1, unidade: "KG", perda: 0 }] };
      const r = montar({ fichas: [prato, MASSA], vendas: [venda({ codigo: "P1", nome: "FILE", valor: 300 })], vinculosPrato: [{ codigo: "P1", pratoId: "d1" }] });
      expect(r.cobertura.receitaCoberta).toBe(0);
      expect(r.semVinculo[0]).toMatchObject({ motivo: "FICHA_INCOMPLETA" });
    });
  });

  describe("cobertura", () => {
    it("mede a receita coberta sobre a receita vendida, fora o buffet", () => {
      const r = montar({
        vendas: [
          venda({ codigo: "P1", nome: "FILE", valor: 600, quantidade: 10 }),
          venda({ codigo: "P2", nome: "OUTRO PRATO", valor: 200 }),
          venda({ codigo: "B1", nome: "BUFFET ALMOCO", valor: 9000 })
        ],
        vinculosPrato: [{ codigo: "P1", pratoId: "d1" }]
      });
      expect(r.cobertura).toMatchObject({ receitaTotal: 800, receitaCoberta: 600, pct: 0.75, receitaBuffet: 9000 });
    });

    it("lista o que esta sem vinculo, do que mais vendeu para o que menos vendeu", () => {
      const r = montar({
        vendas: [
          venda({ codigo: "P2", nome: "PEQUENO", valor: 100 }),
          venda({ codigo: "P3", nome: "GRANDE", valor: 900 }),
          venda({ codigo: null, nome: "SEM CODIGO", valor: 300 })
        ]
      });
      expect(r.semVinculo.map((s) => s.nome)).toEqual(["GRANDE", "SEM CODIGO", "PEQUENO"]);
      expect(r.semVinculo[0]).toMatchObject({ motivo: "SEM_VINCULO", receita: 900 });
    });

    it("limita a lista de trabalho aos 30 maiores", () => {
      const vendas = Array.from({ length: 40 }, (_, i) => venda({ codigo: `X${i}`, nome: `PROD ${i}`, valor: 100 + i }));
      const r = montar({ vendas });
      expect(r.semVinculo).toHaveLength(30);
      expect(r.cobertura.semVinculoTotal).toBe(40);
    });

    it("ignora produto sem venda paga na cobertura", () => {
      const r = montar({ vendas: [venda({ codigo: "P1", nome: "CORTESIA", valor: 0, quantidade: 5 })], vinculosPrato: [{ codigo: "P1", pratoId: "d1" }] });
      expect(r.cobertura.receitaTotal).toBe(0);
      // o consumo existe mesmo assim: cortesia tambem sai da cozinha
      expect(r.insumos.find((i) => i.insumoId === "p-file")?.consumo).toBe(1.1);
    });
  });

  describe("ficha de producao como ingrediente", () => {
    // Massa rende 10 KG; 1 KG de massa leva 600 G de farinha e 4 ovos (por KG de massa: 60 G e 0,4 ovo x10 = receita inteira).
    const MASSA: FichaDoPrato = {
      id: "massa", nome: "Massa de nhoque", rendimento: 10, unidadeRendimento: "KG", rendimentoEmPorcao: false,
      itens: [
        { insumoId: "p-farinha", insumo: "Farinha", quantidade: 6, unidade: "KG", perda: 0, unidadeEstoque: "KG", conversoes: [] },
        { insumoId: "p-ovo", insumo: "Ovo", quantidade: 40, unidade: "UN", perda: 0, unidadeEstoque: "UN", conversoes: [] }
      ]
    };
    const NHOQUE: FichaDoPrato = {
      id: "nhoque", nome: "Nhoque ao sugo", rendimento: 1, unidadeRendimento: "UN", rendimentoEmPorcao: true,
      itens: [{ componenteId: "massa", quantidade: 250, unidade: "G", perda: 0 }]
    };
    const vendaNhoque = (quantidade: number) => [venda({ codigo: "N1", nome: "NHOQUE", quantidade })];
    const vinculoNhoque = [{ codigo: "N1", pratoId: "nhoque" }];

    it("expande a ficha de producao ate os produtos, na proporcao usada", () => {
      const r = montar({ fichas: [NHOQUE, MASSA], vendas: vendaNhoque(20), vinculosPrato: vinculoNhoque });
      // 20 porcoes x 250 G = 5 KG de massa = meia receita: 3 KG de farinha e 20 ovos
      expect(r.insumos.find((i) => i.insumoId === "p-farinha")).toMatchObject({ consumo: 3, unidade: "KG" });
      expect(r.insumos.find((i) => i.insumoId === "p-ovo")?.consumo).toBe(20);
    });

    it("aplica a perda do item sobre a ficha de producao", () => {
      const r = montar({ fichas: [{ ...NHOQUE, itens: [{ componenteId: "massa", quantidade: 250, unidade: "G", perda: 0.1 }] }, MASSA], vendas: vendaNhoque(20), vinculosPrato: vinculoNhoque });
      expect(r.insumos.find((i) => i.insumoId === "p-farinha")?.consumo).toBe(3.3);
    });

    it("expande ficha de producao dentro de ficha de producao", () => {
      const DOCE: FichaDoPrato = { id: "doce", nome: "Base", rendimento: 2, unidadeRendimento: "KG", rendimentoEmPorcao: false, itens: [{ componenteId: "massa", quantidade: 1, unidade: "KG", perda: 0 }] };
      const prato: FichaDoPrato = { ...NHOQUE, itens: [{ componenteId: "doce", quantidade: 1, unidade: "KG", perda: 0 }] };
      const r = montar({ fichas: [prato, DOCE, MASSA], vendas: vendaNhoque(2), vinculosPrato: vinculoNhoque });
      // 2 KG de base = 1 receita da base = 1 KG de massa = 0,1 receita de massa = 0,6 KG de farinha
      expect(r.insumos.find((i) => i.insumoId === "p-farinha")?.consumo).toBe(0.6);
    });

    it("ficha de producao que nao existe vira problema e o resto do prato continua", () => {
      const prato: FichaDoPrato = { ...NHOQUE, itens: [...FILE.itens, { componenteId: "sumiu", quantidade: 1, unidade: "KG", perda: 0 }] };
      const r = montar({ fichas: [prato], vendas: vendaNhoque(1), vinculosPrato: vinculoNhoque });
      expect(r.problemas).toContainEqual(expect.objectContaining({ tipo: "FICHA_DE_PRODUCAO_INDISPONIVEL", origem: "Nhoque ao sugo" }));
      expect(r.insumos.find((i) => i.insumoId === "p-file")).toBeDefined();
    });

    it("ficha que usa a si mesma nao trava e vira problema", () => {
      const A: FichaDoPrato = { id: "a", nome: "A", rendimento: 1, unidadeRendimento: "KG", rendimentoEmPorcao: false, itens: [{ componenteId: "a", quantidade: 1, unidade: "KG", perda: 0 }] };
      const prato: FichaDoPrato = { ...NHOQUE, itens: [{ componenteId: "a", quantidade: 1, unidade: "KG", perda: 0 }] };
      const r = montar({ fichas: [prato, A], vendas: vendaNhoque(1), vinculosPrato: vinculoNhoque });
      expect(r.problemas).toContainEqual(expect.objectContaining({ tipo: "FICHA_EM_CICLO" }));
    });

    it("respeita o limite de 3 niveis de ficha dentro de ficha", () => {
      const nivel = (id: string, filho: string | null): FichaDoPrato => ({
        id, nome: id, rendimento: 1, unidadeRendimento: "KG", rendimentoEmPorcao: false,
        itens: filho ? [{ componenteId: filho, quantidade: 1, unidade: "KG", perda: 0 }] : [{ insumoId: "p-farinha", insumo: "Farinha", quantidade: 1, unidade: "KG", perda: 0, unidadeEstoque: "KG", conversoes: [] }]
      });
      const prato: FichaDoPrato = { ...NHOQUE, itens: [{ componenteId: "n1", quantidade: 1, unidade: "KG", perda: 0 }] };
      // prato > n1 > n2 > n3 > n4(produto): 4 fichas de producao empilhadas
      const r = montar({ fichas: [prato, nivel("n1", "n2"), nivel("n2", "n3"), nivel("n3", "n4"), nivel("n4", null)], vendas: vendaNhoque(1), vinculosPrato: vinculoNhoque });
      expect(r.problemas).toContainEqual(expect.objectContaining({ tipo: "FICHA_EM_CICLO" }));
      expect(r.insumos.find((i) => i.insumoId === "p-farinha")).toBeUndefined();
    });

    it("unidade do item sem conversao para a unidade de rendimento da ficha vira problema", () => {
      const prato: FichaDoPrato = { ...NHOQUE, itens: [{ componenteId: "massa", quantidade: 1, unidade: "CX", perda: 0 }] };
      const r = montar({ fichas: [prato, MASSA], vendas: vendaNhoque(1), vinculosPrato: vinculoNhoque });
      expect(r.problemas).toContainEqual(expect.objectContaining({ tipo: "SEM_CONVERSAO", insumo: "Massa de nhoque" }));
    });
  });
});
