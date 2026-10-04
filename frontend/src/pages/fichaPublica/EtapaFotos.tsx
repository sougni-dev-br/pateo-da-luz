import { Camera, Check, FileText, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apagarArquivo, baixarArquivo, enviarArquivo, ErroFicha, type Arquivo, type Estado } from "./api";
import { prepararArquivo, tamanhoLegivel } from "./formato";

type Props = {
  codigo: string;
  tipo: "ADMISSAO" | "ATUALIZACAO";
  tipos: Record<string, string>;
  obrigatorios: string[];
  arquivos: Arquivo[];
  onEstado: (e: Estado) => void;
  /** Chave de acesso vencida (401): volta para a confirmação de identidade. */
  onSessaoExpirada: (e: unknown) => boolean;
  /** Busca o estado no servidor (depois de envios e exclusões, e depois de qualquer erro). */
  onRecarregar: () => void;
};

type Ordem = { proximo: () => number; aplicar: (n: number, e: Estado) => void; fim: () => void };

const DICAS: Record<string, string> = {
  FOTO_PESSOA: "Rosto de frente, com fundo claro e boa luz. Sem boné, chapéu ou óculos escuros.",
  DOC_FOTO: "Frente e verso. Pode ser RG ou CNH.",
  COMPROVANTE_ENDERECO: "Conta de luz, água, internet ou telefone dos últimos 3 meses.",
  CTPS: "Página da foto e a de qualificação civil. Na carteira digital, um print da tela.",
  CERTIDAO: "Casado(a): certidão de casamento.",
  FILHOS: "Certidão de nascimento e caderneta de vacinação dos filhos menores de 7 anos.",
};

function Miniatura({ codigo, arquivo }: { codigo: string; arquivo: Arquivo }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!arquivo.mimeType.startsWith("image/")) return undefined;
    let ativo = true;
    let criada: string | null = null;
    baixarArquivo(codigo, arquivo.id)
      .then((blob) => { if (ativo) { criada = URL.createObjectURL(blob); setUrl(criada); } })
      .catch(() => undefined);
    return () => { ativo = false; if (criada) URL.revokeObjectURL(criada); };
  }, [codigo, arquivo.id, arquivo.mimeType]);
  if (url) return <img className="fp-miniatura" src={url} alt="" />;
  return <span className="fp-miniatura fp-miniatura--icone"><FileText size={22} aria-hidden="true" /></span>;
}

function Slot({ codigo, tipo, rotulo, obrigatorio, arquivos, ordem, onSessaoExpirada }: {
  codigo: string; tipo: string; rotulo: string; obrigatorio: boolean; arquivos: Arquivo[]; ordem: Ordem; onSessaoExpirada: (e: unknown) => boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [apagando, setApagando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(lista: FileList | null) {
    if (!lista?.length) return;
    const arquivosEscolhidos = Array.from(lista); // antes de limpar o input (a lista é "viva")
    setErro(null);
    setEnviando(true);
    let atual = "";
    try {
      for (const f of arquivosEscolhidos) {
        atual = f.name;
        const { blob, nome } = await prepararArquivo(f);
        const n = ordem.proximo();
        try {
          ordem.aplicar(n, await enviarArquivo(codigo, tipo, blob, nome));
        } finally {
          ordem.fim();
        }
      }
    } catch (e) {
      if (onSessaoExpirada(e)) return;
      const motivo = e instanceof ErroFicha ? e.message : "Não foi possível enviar. Tente de novo.";
      setErro(arquivosEscolhidos.length > 1 && atual ? `${atual}: ${motivo}` : motivo);
    } finally {
      setEnviando(false);
      if (camera.current) camera.current.value = "";
      if (galeria.current) galeria.current.value = "";
    }
  }

  async function apagar(a: Arquivo) {
    if (apagando || !window.confirm(`Apagar "${a.nomeOriginal}"?`)) return;
    setErro(null);
    setApagando(a.id);
    const n = ordem.proximo();
    try {
      ordem.aplicar(n, await apagarArquivo(codigo, a.id));
    } catch (e) {
      if (!onSessaoExpirada(e)) setErro(e instanceof ErroFicha ? e.message : "Não foi possível apagar.");
    } finally {
      ordem.fim();
      setApagando(null);
    }
  }

  const feito = arquivos.length > 0;
  const selfie = tipo === "FOTO_PESSOA";
  return (
    <section className={`fp-slot${feito ? " fp-slot--feito" : ""}${selfie ? " fp-slot--selfie" : ""}`} aria-labelledby={`slot-${tipo}`}>
      <header className="fp-slot-topo">
        <span className="fp-slot-marca" aria-hidden="true">{feito ? <Check size={16} /> : null}</span>
        <div>
          <h2 id={`slot-${tipo}`} className="fp-slot-titulo">{rotulo}{obrigatorio && <span className="fp-selo">obrigatório</span>}</h2>
          {DICAS[tipo] && <p className="fp-dica">{DICAS[tipo]}</p>}
        </div>
      </header>

      {feito && (
        <ul className="fp-arquivos">
          {arquivos.map((a) => (
            <li key={a.id} className="fp-arquivo">
              <Miniatura codigo={codigo} arquivo={a} />
              <span className="fp-arquivo-nome"><span className="fp-arquivo-nome-texto">{a.nomeOriginal}</span><small>{tamanhoLegivel(a.tamanho)}</small></span>
              <button type="button" className="fp-icone" onClick={() => apagar(a)} disabled={apagando !== null} aria-label={`Apagar ${a.nomeOriginal}`}>
                {apagando === a.id ? <Loader2 size={18} className="fp-girando" aria-hidden="true" /> : <Trash2 size={18} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="fp-slot-acoes">
        <button type="button" className="fp-botao fp-botao--secundario" onClick={() => camera.current?.click()} disabled={enviando}>
          {enviando ? <Loader2 size={18} className="fp-girando" aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
          {enviando ? "Enviando…" : selfie ? (feito ? "Tirar outra selfie" : "Tirar selfie") : feito ? "Tirar outra foto" : "Tirar foto"}
        </button>
        <button type="button" className="fp-botao fp-botao--linha" onClick={() => galeria.current?.click()} disabled={enviando}>
          <ImagePlus size={18} aria-hidden="true" /> {selfie ? "Escolher da galeria" : "Escolher arquivo"}
        </button>
        <input ref={camera} type="file" accept="image/*" capture={selfie ? "user" : "environment"} hidden onChange={(e) => enviar(e.target.files)} />
        <input ref={galeria} type="file" accept={selfie ? "image/*" : "image/*,application/pdf"} multiple={!selfie} hidden onChange={(e) => enviar(e.target.files)} />
      </div>
      {erro && <p className="fp-erro" role="alert">{erro}</p>}
    </section>
  );
}

export function EtapaFotos({ codigo, tipo, tipos, obrigatorios, arquivos, onEstado, onSessaoExpirada, onRecarregar }: Props) {
  // Envios e exclusões ao mesmo tempo: o servidor pode terminar em outra ordem. Enquanto há
  // operação no ar, só vale a resposta mais recente; quando a última termina (ou depois de um
  // erro, inclusive o prazo estourado de um envio que pode ter gravado), a lista vem do servidor.
  const seq = useRef(0);
  const aplicada = useRef(0);
  const pendentes = useRef(0);
  const sequencia: Ordem = {
    proximo: () => { pendentes.current += 1; return ++seq.current; },
    aplicar: (n, e) => { if (n < aplicada.current) return; aplicada.current = n; onEstado(e); },
    fim: () => { pendentes.current = Math.max(0, pendentes.current - 1); if (pendentes.current === 0) onRecarregar(); },
  };
  const exige = tipo === "ADMISSAO" ? obrigatorios : [];
  // Obrigatórios primeiro, depois a ordem do RH.
  const ordem = [...exige, ...Object.keys(tipos).filter((t) => !exige.includes(t))];
  return (
    <div className="fp-slots">
      <p className="fp-texto">
        Fotografe com boa luz, o documento inteiro e sem reflexo. {tipo === "ADMISSAO" ? "Os marcados como obrigatórios são necessários para o registro." : "Envie só o que mudou."}
      </p>
      {ordem.map((t) => (
        <Slot key={t} codigo={codigo} tipo={t} rotulo={tipos[t]} obrigatorio={exige.includes(t)}
          arquivos={arquivos.filter((a) => a.tipo === t)} ordem={sequencia} onSessaoExpirada={onSessaoExpirada} />
      ))}
    </div>
  );
}
