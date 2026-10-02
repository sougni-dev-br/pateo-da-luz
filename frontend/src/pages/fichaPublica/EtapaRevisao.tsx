import { AlertTriangle, Pencil } from "lucide-react";
import type { Arquivo, Dados } from "./api";
import { ETAPAS } from "./etapas";
import { isoParaData, mascaraCep, mascaraCpf, mascaraPis, mascaraTelefone, mascaraTitulo } from "./formato";

type Props = {
  dados: Dados;
  arquivos: Arquivo[];
  tiposArquivo: Record<string, string>;
  falta: string[];
  consentiu: boolean;
  onConsentir: (v: boolean) => void;
  onEditar: (indiceEtapa: number) => void;
};

function mostrar(v: unknown, tipo: string): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (tipo === "data") return isoParaData(v);
  if (tipo === "sexo") return v === "FEMININO" ? "Feminino" : "Masculino";
  const mascara = { cpf: mascaraCpf, cep: mascaraCep, telefone: mascaraTelefone, pis: mascaraPis, titulo: mascaraTitulo }[tipo];
  return mascara ? mascara(String(v)) : String(v);
}

export function EtapaRevisao({ dados, arquivos, tiposArquivo, falta, consentiu, onConsentir, onEditar }: Props) {
  const filhos = dados.filhos ?? [];
  return (
    <div className="fp-revisao">
      {falta.length > 0 && (
        <div className="fp-aviso" role="status">
          <AlertTriangle size={18} aria-hidden="true" />
          <div>
            <strong>Ainda falta:</strong>
            <ul>{falta.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        </div>
      )}

      {ETAPAS.map((etapa, i) => {
        if (etapa.id === "revisao") return null;
        return (
          <section key={etapa.id} className="fp-bloco">
            <header className="fp-bloco-topo">
              <h3>{etapa.titulo}</h3>
              <button type="button" className="fp-link" onClick={() => onEditar(i)}><Pencil size={14} aria-hidden="true" /> Corrigir</button>
            </header>
            {etapa.id === "familia" ? (
              <dl className="fp-lista">
                <div className="fp-lista-linha"><dt>Cônjuge</dt><dd>{mostrar(dados.nomeConjuge, "texto")}</dd></div>
                <div className="fp-lista-linha">
                  <dt>Filhos</dt>
                  <dd>{filhos.length === 0 ? "Nenhum" : filhos.map((f) => `${f.nome}${f.dataNascimento ? ` (${isoParaData(f.dataNascimento)})` : ""}`).join(", ")}</dd>
                </div>
              </dl>
            ) : etapa.id === "fotos" ? (
              <dl className="fp-lista">
                {Object.entries(tiposArquivo).filter(([t]) => arquivos.some((a) => a.tipo === t)).map(([t, rotulo]) => (
                  <div key={t} className="fp-lista-linha"><dt>{rotulo}</dt><dd>{arquivos.filter((a) => a.tipo === t).length} arquivo(s)</dd></div>
                ))}
                {arquivos.length === 0 && <div className="fp-lista-linha"><dt>Fotos</dt><dd>Nenhuma enviada</dd></div>}
              </dl>
            ) : (
              <dl className="fp-lista">
                {etapa.campos.map((c) => (
                  <div key={c.nome} className="fp-lista-linha"><dt>{c.rotulo}</dt><dd>{mostrar(dados[c.nome], c.tipo)}</dd></div>
                ))}
              </dl>
            )}
          </section>
        );
      })}

      <label className="fp-consentimento">
        <input type="checkbox" checked={consentiu} onChange={(e) => onConsentir(e.target.checked)} />
        <span>
          Confirmo que as informações são verdadeiras e autorizo o uso destes dados e documentos pelo Pateo da Luz
          e pela contabilidade para o meu registro e as obrigações trabalhistas (Lei 13.709/2018 — LGPD).
        </span>
      </label>
    </div>
  );
}
