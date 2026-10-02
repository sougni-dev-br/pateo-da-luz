import { describe, expect, test } from "vitest";
import { ETAPAS, corpoDaEtapa, etapaInicial, valoresDe } from "../etapas";
import { cpfValido, dataParaIso, isoParaData, mascaraCpf, mascaraTelefone } from "../formato";
import { filhosParaSalvar } from "../EtapaFamilia";

// Pessoa fictícia.
const etapa = (id: string) => ETAPAS.find((e) => e.id === id)!;

describe("formato", () => {
  test("data DD/MM/AAAA ↔ AAAA-MM-DD, recusando dia que não existe", () => {
    expect(dataParaIso("10/04/1995")).toBe("1995-04-10");
    expect(dataParaIso("31/02/1995")).toBeNull();
    expect(dataParaIso("10/04/95")).toBeNull();
    expect(isoParaData("1995-04-10")).toBe("10/04/1995");
  });

  test("máscaras e CPF", () => {
    expect(mascaraCpf("52998224725")).toBe("529.982.247-25");
    expect(mascaraTelefone("11912345678")).toBe("(11) 91234-5678");
    expect(mascaraTelefone("1132345678")).toBe("(11) 3234-5678");
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("529.982.247-26")).toBe(false);
  });
});

describe("corpoDaEtapa", () => {
  test("obrigatório vazio e CPF inválido viram erro no campo", () => {
    const r = corpoDaEtapa(etapa("voce"), { nomeCompleto: "Fulana", cpf: "111.111.111-11" });
    expect("erros" in r && r.erros).toMatchObject({ nomeCompleto: "Escreva nome e sobrenome.", cpf: "CPF inválido. Confira os números.", dataNascimento: "Preencha este campo." });
  });

  test("data vai em AAAA-MM-DD; data no futuro é recusada", () => {
    const base = { nomeCompleto: "Fulana de Tal", cpf: "529.982.247-25", sexo: "FEMININO", estadoCivil: "Solteiro(a)", racaCor: "Parda", escolaridade: "Médio completo", nomeMae: "Beltrana" };
    const ok = corpoDaEtapa(etapa("voce"), { ...base, dataNascimento: "10/04/1995" });
    expect("corpo" in ok && ok.corpo.dataNascimento).toBe("1995-04-10");
    const futuro = corpoDaEtapa(etapa("voce"), { ...base, dataNascimento: "01/01/2999" });
    expect("erros" in futuro && futuro.erros.dataNascimento).toBeTruthy();
  });

  test("trajeto do VT: exigido na admissão, apagado quando a resposta vira Não", () => {
    const semTrajeto = corpoDaEtapa(etapa("transporte"), { usaVt: true, vtTrajeto: "" }, true);
    expect("erros" in semTrajeto && semTrajeto.erros.vtTrajeto).toBeTruthy();
    expect("corpo" in corpoDaEtapa(etapa("transporte"), { usaVt: true, vtTrajeto: "" }, false)).toBe(true);
    const virouNao = corpoDaEtapa(etapa("transporte"), { usaVt: false, vtTrajeto: "Ônibus 1" }, true);
    expect("corpo" in virouNao && virouNao.corpo.vtTrajeto).toBeNull();
  });
});

describe("reabrir o link", () => {
  test("ficha vazia começa do início; com dados, na primeira etapa incompleta", () => {
    expect(etapaInicial({}, false)).toBe(0);
    const i = etapaInicial({ nomeCompleto: "Fulana de Tal", dataNascimento: "1995-04-10", cpf: "52998224725", sexo: "FEMININO", estadoCivil: "Solteiro(a)", racaCor: "Parda", escolaridade: "Médio completo", nomeMae: "Beltrana" }, false);
    expect(ETAPAS[i].id).toBe("documentos");
  });

  test("valores carregados aparecem com máscara e data no formato brasileiro", () => {
    const v = valoresDe({ cpf: "52998224725", telefone: "11912345678", dataNascimento: "1995-04-10" });
    expect(v).toMatchObject({ cpf: "529.982.247-25", telefone: "(11) 91234-5678", dataNascimento: "10/04/1995", nacionalidade: "Brasileira" });
  });
});

test("filhos: linha em branco é ignorada; CPF e data inválidos apontam a linha", () => {
  expect(filhosParaSalvar([{ nome: "", nascimento: "", cpf: "" }])).toEqual({ filhos: [] });
  const r = filhosParaSalvar([{ nome: "Ciclano", nascimento: "31/02/2015", cpf: "123" }]);
  expect("erros" in r && r.erros).toEqual({ "filho-0-nascimento": "Data inválida.", "filho-0-cpf": "CPF inválido." });
});
