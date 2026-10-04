import { describe, expect, test } from "vitest";
import { conferirDocumentos, pisValido, tituloValido } from "../conferenciaDocumentos";

// Textos como o OCR devolve de fotos de documento (pessoas e números fictícios).
const RG = `REPUBLICA FEDERATIVA DO BRASIL
SECRETARIA DA SEGURANCA PUBLICA
REGISTRO GERAL 12.345.678-9  DATA DE EXPEDICAO 10/02/2015
NOME
JOANA EXEMPLO DA SILVA
FILIACAO
JOSE EXEMPLO DA SILVA
MARIA EXEMPLO DA SILVA
NATURALIDADE SAO PAULO-SP  DATA DE NASCIMENTO 21/07/1998
CPF 123.456.789-09`;

const COMPROVANTE = `ENEL DISTRIBUICAO SAO PAULO
JOANA EXEMPLO DA SILVA
PRACA DA SE 50 - SE
01001-000 SAO PAULO SP
VENCIMENTO 10/09/2026`;

const DIGITADO = {
  nomeCompleto: "Joana Exemplo da Silva", dataNascimento: "1998-07-21", cpf: "12345678909", rg: "12.345.678-9",
  nomeMae: "Maria Exemplo da Silva", nomePai: "José Exemplo da Silva", cep: "01001000",
};

const porCampo = (r: ReturnType<typeof conferirDocumentos>) => Object.fromEntries(r.map((c) => [c.campo, c]));

describe("conferirDocumentos", () => {
  test("tudo digitado certo: confere, inclusive nome com acento contra documento sem acento", () => {
    const r = porCampo(conferirDocumentos(DIGITADO, { DOC_FOTO: RG, COMPROVANTE_ENDERECO: COMPROVANTE }));
    for (const c of ["nomeCompleto", "dataNascimento", "cpf", "rg", "nomeMae", "nomePai", "cep"]) {
      expect(r[c].situacao, c).toBe("confere");
    }
  });

  test("CPF com dígito trocado: sugere o CPF válido do documento", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, cpf: "12345678990" }, { DOC_FOTO: RG }));
    expect(r.cpf).toMatchObject({ situacao: "diverge", lido: "12345678909" });
  });

  test("nascimento digitado errado: sugere a data junto de NASCIMENTO, não a de expedição", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, dataNascimento: "1998-07-12" }, { DOC_FOTO: RG }));
    expect(r.dataNascimento).toMatchObject({ situacao: "diverge", lido: "1998-07-21" });
  });

  test("nome com erro de digitação: sugere a linha do documento", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, nomeCompleto: "Joana Exmplo da Silva", nomeMae: "Maria Exemplo da Silv" }, { DOC_FOTO: RG }));
    expect(r.nomeCompleto).toMatchObject({ situacao: "diverge", lido: "JOANA EXEMPLO DA SILVA" });
    expect(r.nomeMae).toMatchObject({ situacao: "diverge", lido: "MARIA EXEMPLO DA SILVA" });
  });

  test("nome muito diferente do que está no documento não vira sugestão (pode ser foto de outra pessoa)", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, nomePai: "Carlos Pereira" }, { DOC_FOTO: RG }));
    expect(r.nomePai.situacao).toBe("nao_lido");
  });

  test("RG com número trocado: sugere o número após REGISTRO GERAL", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, rg: "12.345.687-9" }, { DOC_FOTO: RG }));
    expect(r.rg).toMatchObject({ situacao: "diverge", lido: "12.345.678-9" });
  });

  test("CEP diferente no comprovante: sugere o do comprovante", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, cep: "01010000" }, { COMPROVANTE_ENDERECO: COMPROVANTE }));
    expect(r.cep).toMatchObject({ situacao: "diverge", lido: "01001000" });
  });

  test("sem a foto do documento: não lido, sem inventar", () => {
    const r = porCampo(conferirDocumentos(DIGITADO, {}));
    expect(r.cpf.situacao).toBe("nao_lido");
    expect(r.cep.situacao).toBe("nao_lido");
  });

  test("foto ilegível (texto sem números válidos): não lido", () => {
    const r = porCampo(conferirDocumentos(DIGITADO, { DOC_FOTO: "R3G1STR0 G3R4L ### 1l2 S4O" }));
    expect(r.cpf.situacao).toBe("nao_lido");
    expect(r.dataNascimento.situacao).toBe("nao_lido");
  });

  test("dois CPFs válidos diferentes no texto e nenhum é o digitado: não arrisca sugestão", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, cpf: "52998224725" }, { DOC_FOTO: "CPF 123.456.789-09", CPF: "CPF 111.444.777-35" }));
    expect(r.cpf.situacao).toBe("nao_lido");
  });

  test("PIS e título: confere pelos dígitos verificadores", () => {
    const ctps = "PIS/PASEP 120.12345.67-2";
    const r = porCampo(conferirDocumentos({ pis: "12012345672" }, { CTPS: ctps }));
    expect(pisValido("12012345672")).toBe(true);
    expect(r.pis.situacao).toBe("confere");
    expect(tituloValido("102385010671")).toBe(true);
    const t = porCampo(conferirDocumentos({ tituloEleitor: "102385010617" }, { TITULO: "INSCRICAO 1023 8501 0671 ZONA 001" }));
    expect(t.tituloEleitor).toMatchObject({ situacao: "diverge", lido: "102385010671" });
  });

  test("só CPF, PIS e título contam como leitura segura", () => {
    const r = porCampo(conferirDocumentos({ ...DIGITADO, cpf: "12345678990", nomeCompleto: "Joana Exmplo da Silva" }, { DOC_FOTO: RG }));
    expect(r.cpf.seguro).toBe(true);
    expect(r.nomeCompleto.seguro).toBe(false);
  });

  test("data com outro rótulo no meio (expedição) não vira nascimento", () => {
    const texto = "NASCIMENTO\nDATA DE EXPEDICAO 10/02/2015";
    const r = porCampo(conferirDocumentos({ dataNascimento: "1998-07-12" }, { DOC_FOTO: texto }));
    expect(r.dataNascimento.situacao).toBe("nao_lido");
  });

  test("duas datas de nascimento diferentes no documento: não sugere", () => {
    const texto = "DATA DE NASCIMENTO 21/07/1998\nNASCIMENTO DO CONJUGE 03/03/1990";
    const r = porCampo(conferirDocumentos({ dataNascimento: "1998-07-12" }, { DOC_FOTO: texto }));
    expect(r.dataNascimento.situacao).toBe("nao_lido");
  });

  test("certidão não é fonte da data de nascimento (a de casamento traz a do cônjuge)", () => {
    const r = porCampo(conferirDocumentos({ dataNascimento: "1998-07-12" }, { CERTIDAO: "DATA DE NASCIMENTO 21/07/1998" }));
    expect(r.dataNascimento.situacao).toBe("nao_lido");
  });

  test("a mãe não vira o pai: linha do nome de outro campo é ignorada", () => {
    const texto = "FILIACAO\nMARIO SILVA SANTOS\nANA PEREIRA LIMA";
    const r = porCampo(conferirDocumentos({ nomePai: "Mario Silva Santos", nomeMae: "Maria Silva Santos" }, { DOC_FOTO: texto }));
    expect(r.nomePai.situacao).toBe("confere");
    expect(r.nomeMae.situacao).toBe("nao_lido");
  });

  test("duas linhas parecidas com o nome: não arrisca", () => {
    const texto = "MARIO SILVA SANTOS\nMARIA SILVA SANTTOS";
    const r = porCampo(conferirDocumentos({ nomeMae: "Maria Silva Santos" }, { DOC_FOTO: texto }));
    expect(r.nomeMae.situacao).toBe("nao_lido");
  });

  test("sugestão de nome mantém acento e apóstrofo do documento", () => {
    const r = porCampo(conferirDocumentos({ nomeCompleto: "Jose Dávla Neto" }, { DOC_FOTO: "NOME\nJOSÉ D'ÁVILA NETO" }));
    expect(r.nomeCompleto).toMatchObject({ situacao: "diverge", lido: "JOSÉ D'ÁVILA NETO" });
  });

  test("CPF dentro de um número maior (protocolo, CNPJ) não é sugerido", () => {
    const r = porCampo(conferirDocumentos({ cpf: "11144477735" }, { DOC_FOTO: "PROTOCOLO 91234567890901" }));
    expect(r.cpf.situacao).toBe("nao_lido");
  });

  test("RG: números separados no texto não conferem juntos, e a sugestão segue o formato digitado", () => {
    const r = porCampo(conferirDocumentos({ rg: "123456789" }, { DOC_FOTO: "SEXO F CODIGO 123 45678 9" }));
    expect(r.rg.situacao).toBe("nao_lido");
    const s = porCampo(conferirDocumentos({ rg: "123456780" }, { DOC_FOTO: "REGISTRO GERAL\n12.345.678-9" }));
    expect(s.rg).toMatchObject({ situacao: "diverge", lido: "123456789" });
  });

  test("campo não digitado não entra na conferência", () => {
    const r = conferirDocumentos({ cpf: "12345678909" }, { DOC_FOTO: RG });
    expect(r.map((c) => c.campo)).toEqual(["cpf"]);
  });
});
