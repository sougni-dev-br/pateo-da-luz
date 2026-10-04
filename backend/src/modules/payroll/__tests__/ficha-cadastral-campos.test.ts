import { describe, expect, test } from "vitest";
import {
  cpfValido, dadosDoFuncionario, dataValida, diferencas, dividirNome, faltaParaFinalizar, filhosAlterados, filhosNovos, lerDadosEmpresa,
  lerDadosPessoa, tipoDaChavePix, verificacaoNecessaria,
} from "../ficha-cadastral-campos.js";

// Pessoa fictícia.
const COMPLETA = {
  nomeCompleto: "Fulana de Tal Souza", dataNascimento: "1995-04-10", sexo: "FEMININO", cpf: "529.982.247-25",
  nomeMae: "Beltrana de Tal", estadoCivil: "Solteiro(a)", racaCor: "Parda", escolaridade: "Médio completo", rg: "12.345.678-9",
  cep: "01000-000", endereco: "Rua das Flores", numero: "10", bairro: "Centro", cidade: "Sao Paulo", uf: "SP",
  telefone: "(11) 91234-5678", usaVt: false,
};

describe("lerDadosPessoa", () => {
  test("limpa máscara de CPF, CEP e telefone e lê só os campos presentes", () => {
    const r = lerDadosPessoa({ cpf: "529.982.247-25", cep: "01000-000", telefone: "(11) 91234-5678" });
    expect(r).toEqual({ dados: { cpf: "52998224725", cep: "01000000", telefone: "11912345678" } });
  });

  test("recusa CPF com dígito errado", () => {
    expect(lerDadosPessoa({ cpf: "529.982.247-26" })).toEqual({ erro: "CPF inválido. Confira os números." });
  });

  test("recusa data que não existe e data no futuro", () => {
    expect(lerDadosPessoa({ dataNascimento: "1995-02-30" })).toHaveProperty("erro");
    expect(lerDadosPessoa({ dataNascimento: "2999-01-01" })).toHaveProperty("erro");
  });

  test("opção fora da lista é recusada; vazio limpa", () => {
    expect(lerDadosPessoa({ racaCor: "Azul" })).toHaveProperty("erro");
    expect(lerDadosPessoa({ racaCor: "" })).toEqual({ dados: { racaCor: null } });
  });

  test("campo desconhecido é ignorado e texto longo é cortado", () => {
    const r = lerDadosPessoa({ baseSalary: 99999, nomeMae: "x".repeat(500) });
    expect(r).toEqual({ dados: { nomeMae: "x".repeat(120) } });
  });

  test("booleano em texto é recusado", () => {
    expect(lerDadosPessoa({ usaVt: "true" })).toHaveProperty("erro");
  });

  test("filhos: ignora linha sem nome, valida CPF e data", () => {
    const r = lerDadosPessoa({ filhos: [{ nome: "ciclano de tal", dataNascimento: "2015-01-02", cpf: "111.444.777-35" }, { nome: "" }] });
    expect(r).toEqual({ dados: { filhos: [{ nome: "Ciclano de Tal", dataNascimento: "2015-01-02", cpf: "11144477735", ref: null }] } });
    const comRef = lerDadosPessoa({ filhos: [{ nome: "A B", ref: "dep-1" }, { nome: "C D", ref: "x'; drop" }] }) as { dados: { filhos: Array<{ ref: unknown }> } };
    expect(comRef.dados.filhos.map((f) => f.ref)).toEqual(["dep-1", null]);
    expect(lerDadosPessoa({ filhos: [{ nome: "A", cpf: "123" }] })).toHaveProperty("erro");
    expect(lerDadosPessoa({ filhos: Array.from({ length: 11 }, () => ({ nome: "A" })) })).toHaveProperty("erro");
  });
});

describe("faltaParaFinalizar", () => {
  const lida = () => (lerDadosPessoa(COMPLETA) as { dados: Record<string, never> }).dados;

  test("completa com os documentos obrigatórios não falta nada", () => {
    expect(faltaParaFinalizar(lida(), ["FOTO_PESSOA", "DOC_FOTO", "COMPROVANTE_ENDERECO"], true)).toEqual([]);
  });

  test("admissão sem fotos pede as obrigatórias; atualização não", () => {
    expect(faltaParaFinalizar(lida(), [], true)).toEqual(["Sua foto (rosto)", "Foto: Documento com foto (RG ou CNH)", "Foto: Comprovante de endereço"]);
    expect(faltaParaFinalizar(lida(), [], false)).toEqual([]);
  });

  test("na admissão, quem usa VT precisa contar o trajeto; nome sem sobrenome não passa", () => {
    const falta = faltaParaFinalizar({ ...lida(), usaVt: true, nomeCompleto: "Fulana" }, [], true);
    expect(falta).toContain("Trajeto do vale-transporte");
    expect(falta[0]).toBe("Nome completo (nome e sobrenome)");
  });

  test("na atualização o trajeto não é exigido (já está no cadastro)", () => {
    expect(faltaParaFinalizar({ ...lida(), usaVt: true }, [], false)).toEqual([]);
  });
});

describe("lerDadosEmpresa", () => {
  test("lê horários, valores e modalidade", () => {
    const r = lerDadosEmpresa({ entrada: "09:00", saida: "18:00", salario: "2500.456", modalidade: "NAO_CLT", valeTransporte: true });
    expect(r).toMatchObject({ dados: { entrada: "09:00", saida: "18:00", salario: 2500.46, modalidade: "NAO_CLT", valeTransporte: true } });
  });

  test("recusa admissão que não existe no calendário", () => {
    expect(lerDadosEmpresa({ admissao: "2026-02-31" })).toHaveProperty("erro");
    expect(lerDadosEmpresa({ admissao: "2026-11-02" })).toMatchObject({ dados: { admissao: "2026-11-02" } });
  });

  test("recusa horário inválido e salário negativo", () => {
    expect(lerDadosEmpresa({ entrada: "25:00" })).toHaveProperty("erro");
    expect(lerDadosEmpresa({ salario: -1 })).toHaveProperty("erro");
  });
});

describe("cadastro", () => {
  const funcionario = {
    firstName: "Fulana", lastName: "Souza", cpf: "52998224725", birthDate: new Date("1995-04-10T00:00:00Z"), gender: "NAO_INFORMADO",
    city: "São Paulo", phone: "11912345678", baseSalary: 2500, vtType: "NENHUM",
  };

  test("dadosDoFuncionario monta a ficha com o cadastro e sem salário", () => {
    const d = dadosDoFuncionario(funcionario, [{ id: "dep-1", nome: "Ciclano", dataNascimento: null, cpf: null }]);
    expect(d).toMatchObject({ nomeCompleto: "Fulana Souza", dataNascimento: "1995-04-10", cpf: "52998224725", cidade: "São Paulo" });
    expect(d.sexo).toBeUndefined();
    expect(d.usaVt).toBe(false);
    expect(JSON.stringify(d)).not.toContain("2500");
    expect(d.filhos).toEqual([{ nome: "Ciclano", dataNascimento: null, cpf: null, ref: "dep-1" }]);
  });

  test("cadastro sem nome completo: compara com nome + sobrenome (não aponta mudança falsa)", () => {
    const semCompleto = { ...funcionario, nomeCompleto: null };
    expect(diferencas({ nomeCompleto: "Fulana Souza" }, semCompleto)).toEqual([]);
    expect(diferencas({ nomeCompleto: "Fulana de Souza" }, semCompleto)).toEqual([
      { campo: "nomeCompleto", rotulo: "Nome completo", atual: "Fulana Souza", novo: "Fulana de Souza" },
    ]);
  });

  test("filho corrigido pela referência vira correção de nome, não filho novo", () => {
    const existentes = [{ id: "dep-1", nome: "Ciclano Sousa", dataNascimento: null, cpf: null }];
    const ficha = [{ nome: "Ciclano Souza", dataNascimento: "2015-01-20", cpf: null, ref: "dep-1" }];
    expect(filhosNovos(ficha, existentes)).toEqual([]);
    expect(filhosAlterados(ficha, existentes)).toEqual([
      { dependenteId: "dep-1", nome: "Ciclano Sousa", nomeNovo: "Ciclano Souza", dataNascimento: { atual: null, novo: "2015-01-20" } },
    ]);
    // Referência de dependente de outro funcionário não vale: é filho novo.
    expect(filhosNovos([{ ...ficha[0], ref: "dep-de-outro" }], existentes)).toHaveLength(1);
  });

  test("diferencas ignora o que não mudou (caixa e máscara) e campo vazio da ficha", () => {
    const d = { cpf: "52998224725", cidade: "SAO PAULO", telefone: "11912345678", nomeMae: "beltrana de tal", rg: null };
    expect(diferencas(d, { ...funcionario, nomeMae: null, rg: "123" })).toEqual([
      { campo: "nomeMae", rotulo: "Nome da mãe", atual: null, novo: "Beltrana de Tal" },
    ]);
  });

  test("dividirNome: prenome e o resto", () => {
    expect(dividirNome("FULANA DE TAL SOUZA")).toEqual({ firstName: "Fulana", lastName: "de Tal Souza" });
  });

  test("filhosNovos compara sem acento nem caixa", () => {
    expect(filhosNovos([{ nome: "João Silva", dataNascimento: null, cpf: null }, { nome: "Ana", dataNascimento: null, cpf: null }], [{ nome: "JOAO SILVA" }]))
      .toEqual([{ nome: "Ana", dataNascimento: null, cpf: null }]);
  });
});

test("filhosAlterados: só o que a ficha informou diferente; vazio na ficha não apaga", () => {
  const existentes = [
    { id: "d1", nome: "João Silva", dataNascimento: new Date("2015-01-20T00:00:00Z"), cpf: null },
    { id: "d2", nome: "Ana", dataNascimento: new Date("2018-03-03T00:00:00Z"), cpf: "529.982.247-25" },
  ];
  const filhos = [
    { nome: "JOAO SILVA", dataNascimento: "2015-01-02", cpf: "11144477735" },
    { nome: "Ana", dataNascimento: null, cpf: "52998224725" },
  ];
  expect(filhosAlterados(filhos, existentes)).toEqual([
    { dependenteId: "d1", nome: "João Silva", dataNascimento: { atual: "2015-01-20", novo: "2015-01-02" }, cpf: { atual: null, novo: "11144477735" } },
  ]);
});

test("filhosAlterados: homônimos não são corrigidos sozinhos", () => {
  const existentes = [
    { id: "d1", nome: "Ana", dataNascimento: new Date("2015-01-20T00:00:00Z"), cpf: null },
    { id: "d2", nome: "ANA", dataNascimento: new Date("2018-03-03T00:00:00Z"), cpf: null },
  ];
  expect(filhosAlterados([{ nome: "Ana", dataNascimento: "2016-01-01", cpf: null }], existentes)).toEqual([]);
});

test("tipo da chave PIX pelo formato", () => {
  expect(tipoDaChavePix("529.982.247-25")).toBe("CPF");
  expect(tipoDaChavePix("fulana@exemplo.com")).toBe("EMAIL");
  expect(tipoDaChavePix("(11) 91234-5678")).toBe("TELEFONE");
  expect(tipoDaChavePix("123e4567-e89b-12d3-a456-426614174000")).toBe("ALEATORIA");
  expect(tipoDaChavePix("chave estranha")).toBeNull();
});

test("diferença ignora pontuação do RG", () => {
  expect(diferencas({ rg: "12.345.678-9" }, { rg: "123456789" })).toEqual([]);
});

test("verificação: nascimento, senão CPF, senão nada", () => {
  expect(verificacaoNecessaria({ dataNascimento: "1995-04-10", cpf: "52998224725" })).toBe("NASCIMENTO");
  expect(verificacaoNecessaria({ cpf: "52998224725" })).toBe("CPF");
  expect(verificacaoNecessaria({})).toBeNull();
});

test("cpfValido e dataValida", () => {
  expect(cpfValido("52998224725")).toBe(true);
  expect(cpfValido("11111111111")).toBe(false);
  expect(dataValida("2024-02-29")).toBe(true);
  expect(dataValida("2023-02-29")).toBe(false);
});
