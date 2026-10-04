// Ficha cadastral impressa para assinar e mandar à contabilidade — o modelo dela, em uma
// folha A4, já preenchido. Fica num portal fora do app e só aparece na impressão.
import { createPortal } from "react-dom";
import type { FichaCadastralDetalhe, FichaCadastralEmpresa } from "../../../api/client";
import { valorLegivel } from "./DadosPessoa";
import { diaBr, formatarCnpj, valorBr } from "./fichaFormato";

export const CLASSE_IMPRIMINDO = "imprimindo-ficha-cadastral";

type Celula = { rotulo: string; valor?: string | null; span: number };

function Linha({ celulas }: { celulas: Celula[] }) {
  return (
    <div className="fi-linha">
      {celulas.map((c, i) => (
        <div key={i} className="fi-celula" style={{ gridColumn: `span ${c.span}` }}>
          <span className="fi-rotulo">{c.rotulo}</span>
          <span className="fi-valor">{c.valor && c.valor !== "—" ? c.valor : " "}</span>
        </div>
      ))}
    </div>
  );
}

const marca = (sim: boolean | null | undefined, rotulo: string) => `(${sim ? "X" : " "}) ${rotulo}`;
// O valor pode estar como o RH digitou ("1.500,00"): Number() daria "R$ NaN" na folha assinada.
const dinheiro = (v: unknown) => {
  const n = valorBr(v);
  return n == null ? "" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

export function FichaImpressao({ ficha, empresa, fotoUrl }: { ficha: FichaCadastralDetalhe; empresa: FichaCadastralEmpresa; fotoUrl?: string | null }) {
  const d = ficha.dados;
  const v = (campo: string) => valorLegivel(campo, d[campo]);
  const firma = ficha.empresas.find((e) => e.id === empresa.companyId);
  const endereco = [d.endereco, d.numero, d.complemento].filter(Boolean).join(", ");
  const filhos = [...(d.filhos ?? [])];
  while (filhos.length < 3) filhos.push({ nome: "", dataNascimento: null, cpf: null });
  const vt = empresa.valeTransporte ?? (d.usaVt === true ? true : d.usaVt === false ? false : null);
  const intervalo = empresa.intervaloInicio || empresa.intervaloFim ? `das ${empresa.intervaloInicio ?? "____"} às ${empresa.intervaloFim ?? "____"}` : "";

  return createPortal(
    <div className="fi-raiz" aria-hidden="true">
      <article className="fi-folha">
        <header className="fi-cabecalho">
          <h1 className="fi-titulo">FICHA CADASTRAL DE EMPREGADO</h1>
          {/* Espaço da foto 3x4: a que a pessoa mandou pelo link, ou em branco para colar a impressa. */}
          <div className="fi-foto">{fotoUrl ? <img src={fotoUrl} alt="" /> : <span>FOTO 3x4</span>}</div>
        </header>

        <h2 className="fi-secao">1. Empresa</h2>
        <Linha celulas={[{ rotulo: "Nome da empresa", valor: firma?.legalName, span: 8 }, { rotulo: "CNPJ", valor: firma ? formatarCnpj(firma.cnpj) : "", span: 4 }]} />

        <h2 className="fi-secao">2. Dados pessoais</h2>
        <Linha celulas={[{ rotulo: "Nome do funcionário", valor: v("nomeCompleto"), span: 12 }]} />
        <Linha celulas={[{ rotulo: "Nome do pai", valor: v("nomePai"), span: 12 }]} />
        <Linha celulas={[{ rotulo: "Nome da mãe", valor: v("nomeMae"), span: 12 }]} />
        <Linha celulas={[
          { rotulo: "Data de nascimento", valor: v("dataNascimento"), span: 3 }, { rotulo: "CPF", valor: v("cpf"), span: 3 },
          { rotulo: "Sexo", valor: v("sexo"), span: 2 }, { rotulo: "Estado civil", valor: v("estadoCivil"), span: 4 },
        ]} />
        <Linha celulas={[{ rotulo: "Raça/cor", valor: v("racaCor"), span: 4 }, { rotulo: "Escolaridade", valor: v("escolaridade"), span: 4 }, { rotulo: "Pessoa com deficiência", valor: v("possuiDeficiencia"), span: 4 }]} />
        <Linha celulas={[{ rotulo: "Nacionalidade", valor: v("nacionalidade"), span: 4 }, { rotulo: "Naturalidade", valor: v("naturalidade"), span: 8 }]} />

        <h2 className="fi-secao">3. Documentos</h2>
        <Linha celulas={[
          { rotulo: "RG nº", valor: v("rg"), span: 4 }, { rotulo: "Órgão emissor", valor: v("rgOrgaoEmissor"), span: 3 },
          { rotulo: "UF", valor: v("rgUf"), span: 2 }, { rotulo: "Data de emissão", valor: v("rgDataEmissao"), span: 3 },
        ]} />
        <Linha celulas={[
          { rotulo: "CTPS nº", valor: v("ctpsNumero"), span: 4 }, { rotulo: "Série", valor: v("ctpsSerie"), span: 3 },
          { rotulo: "UF", valor: v("ctpsUf"), span: 2 }, { rotulo: "PIS/PASEP", valor: v("pis"), span: 3 },
        ]} />
        <Linha celulas={[{ rotulo: "Título de eleitor", valor: v("tituloEleitor"), span: 6 }, { rotulo: "Zona", valor: v("tituloZona"), span: 3 }, { rotulo: "Seção", valor: v("tituloSecao"), span: 3 }]} />

        <h2 className="fi-secao">4. Endereço e contato</h2>
        <Linha celulas={[{ rotulo: "Endereço", valor: endereco, span: 9 }, { rotulo: "CEP", valor: v("cep"), span: 3 }]} />
        <Linha celulas={[{ rotulo: "Bairro", valor: v("bairro"), span: 5 }, { rotulo: "Cidade", valor: v("cidade"), span: 5 }, { rotulo: "UF", valor: v("uf"), span: 2 }]} />
        <Linha celulas={[{ rotulo: "Telefone", valor: v("telefone"), span: 5 }, { rotulo: "E-mail", valor: v("email"), span: 7 }]} />

        <h2 className="fi-secao">5. Família</h2>
        <Linha celulas={[{ rotulo: "Nome do cônjuge", valor: v("nomeConjuge"), span: 12 }]} />
        {filhos.map((f, i) => (
          <Linha key={i} celulas={[
            { rotulo: i === 0 ? "Filhos — nome" : "", valor: f.nome, span: 6 },
            { rotulo: i === 0 ? "Nascimento" : "", valor: diaBr(f.dataNascimento), span: 3 },
            { rotulo: i === 0 ? "CPF" : "", valor: f.cpf ? valorLegivel("cpf", f.cpf) : "", span: 3 },
          ]} />
        ))}

        <h2 className="fi-secao">6. Contrato</h2>
        <Linha celulas={[{ rotulo: "Data de admissão", valor: diaBr(empresa.admissao), span: 3 }, { rotulo: "Função", valor: empresa.funcao, span: 6 }, { rotulo: "Salário", valor: dinheiro(empresa.salario), span: 3 }]} />
        <Linha celulas={[
          { rotulo: "Vale-transporte", valor: `${marca(vt === true, "SIM")}   ${marca(vt === false, "NÃO")}`, span: 5 },
          { rotulo: "Valor do VT", valor: dinheiro(empresa.valorVt), span: 7 },
        ]} />
        <Linha celulas={[{ rotulo: "Entrada", valor: empresa.entrada, span: 3 }, { rotulo: "Intervalo", valor: intervalo, span: 6 }, { rotulo: "Saída", valor: empresa.saida, span: 3 }]} />
        <Linha celulas={[{ rotulo: "Sábados — entrada", valor: empresa.sabadoEntrada, span: 6 }, { rotulo: "Sábados — saída", valor: empresa.sabadoSaida, span: 6 }]} />
        <Linha celulas={[{ rotulo: "Folga semanal / observações", valor: [empresa.folga, empresa.observacoes].filter(Boolean).join(" · "), span: 12 }]} />

        <p className="fi-data">SÃO PAULO, ______ de ______________________ de ________</p>
        <div className="fi-assinaturas">
          <div><span className="fi-traco" /><small>Assinatura do empregado</small></div>
          <div><span className="fi-traco" /><small>Assinatura do responsável pela empresa</small></div>
        </div>
      </article>
    </div>,
    document.body,
  );
}

export function imprimirFicha() {
  const estilo = document.createElement("style");
  estilo.textContent = "@page { size: A4 portrait; margin: 10mm 12mm; }";
  document.head.appendChild(estilo);
  document.body.classList.add(CLASSE_IMPRIMINDO);
  const limpar = () => {
    document.body.classList.remove(CLASSE_IMPRIMINDO);
    estilo.remove();
    window.removeEventListener("afterprint", limpar);
  };
  window.addEventListener("afterprint", limpar);
  window.print();
}
