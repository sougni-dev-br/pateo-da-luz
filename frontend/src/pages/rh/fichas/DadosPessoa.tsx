import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { getArquivoFichaCadastral, type FichaCadastralArquivo, type FichaCadastralDados } from "../../../api/client";
import { diaBr, formatarCep, formatarCpf, formatarTelefone } from "./fichaFormato";

const GRUPOS: Array<{ titulo: string; campos: string[] }> = [
  { titulo: "Pessoais", campos: ["nomeCompleto", "dataNascimento", "cpf", "sexo", "estadoCivil", "racaCor", "escolaridade", "nacionalidade", "naturalidade", "nomeMae", "nomePai", "possuiDeficiencia"] },
  { titulo: "Documentos", campos: ["rg", "rgOrgaoEmissor", "rgUf", "rgDataEmissao", "ctpsNumero", "ctpsSerie", "ctpsUf", "pis", "tituloEleitor", "tituloZona", "tituloSecao"] },
  { titulo: "Endereço e contato", campos: ["cep", "endereco", "numero", "complemento", "bairro", "cidade", "uf", "telefone", "email"] },
  { titulo: "Transporte e pagamento", campos: ["usaVt", "vtTrajeto", "pixChave"] },
];

export function valorLegivel(campo: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (campo === "cpf") return formatarCpf(v);
  if (campo === "cep") return formatarCep(v);
  if (campo === "telefone") return formatarTelefone(v);
  if (campo === "sexo") return v === "FEMININO" ? "Feminino" : v === "MASCULINO" ? "Masculino" : String(v);
  if (/^data|DataEmissao$/.test(campo)) return diaBr(String(v));
  return String(v);
}

export function DadosPessoa({ dados, rotulos }: { dados: FichaCadastralDados; rotulos: Record<string, string> }) {
  const filhos = dados.filhos ?? [];
  return (
    <div className="fc-dados">
      {GRUPOS.map((g) => (
        <section key={g.titulo} className="fc-grupo">
          <h3>{g.titulo}</h3>
          <dl>
            {g.campos.map((c) => (
              <div key={c} className="fc-linha"><dt>{rotulos[c] ?? c}</dt><dd>{valorLegivel(c, dados[c])}</dd></div>
            ))}
          </dl>
        </section>
      ))}
      <section className="fc-grupo">
        <h3>Família</h3>
        <dl>
          <div className="fc-linha"><dt>Cônjuge</dt><dd>{valorLegivel("nomeConjuge", dados.nomeConjuge)}</dd></div>
          {filhos.length === 0 && <div className="fc-linha"><dt>Filhos</dt><dd>Nenhum</dd></div>}
          {filhos.map((f, i) => (
            <div key={i} className="fc-linha">
              <dt>Filho(a) {i + 1}</dt>
              <dd>{f.nome}{f.dataNascimento ? ` · ${diaBr(f.dataNascimento)}` : ""}{f.cpf ? ` · CPF ${formatarCpf(f.cpf)}` : ""}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

function Documento({ fichaId, arquivo, rotulo }: { fichaId: string; arquivo: FichaCadastralArquivo; rotulo: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    let ativo = true;
    let criada: string | null = null;
    getArquivoFichaCadastral(fichaId, arquivo.id)
      .then((blob) => { if (!ativo) return; criada = URL.createObjectURL(blob); setUrl(criada); })
      .catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [fichaId, arquivo.id]);
  const imagem = arquivo.mimeType.startsWith("image/");
  return (
    <a className="fc-doc" href={url ?? undefined} target="_blank" rel="noopener noreferrer" aria-disabled={!url}
      onClick={(e) => { if (!url) e.preventDefault(); }}>
      {imagem && url ? <img src={url} alt={`${rotulo} — ${arquivo.nomeOriginal}`} /> : <span className="fc-doc-icone"><FileText size={28} aria-hidden="true" /></span>}
      <span className="fc-doc-rotulo"><strong>{rotulo}</strong><small>{erro ? "Não abriu" : arquivo.nomeOriginal}</small></span>
    </a>
  );
}

export function DocumentosFicha({ fichaId, arquivos, tipos }: { fichaId: string; arquivos: FichaCadastralArquivo[]; tipos: Record<string, string> }) {
  if (arquivos.length === 0) return <p className="fc-vazio">Nenhum documento enviado.</p>;
  return (
    <div className="fc-docs">
      {arquivos.map((a) => <Documento key={a.id} fichaId={fichaId} arquivo={a} rotulo={tipos[a.tipo] ?? a.tipo} />)}
    </div>
  );
}
