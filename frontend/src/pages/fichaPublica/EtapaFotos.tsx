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
};

const DICAS: Record<string, string> = {
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

function Slot({ codigo, tipo, rotulo, obrigatorio, arquivos, onEstado }: {
  codigo: string; tipo: string; rotulo: string; obrigatorio: boolean; arquivos: Arquivo[]; onEstado: (e: Estado) => void;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(lista: FileList | null) {
    if (!lista?.length) return;
    setErro(null);
    setEnviando(true);
    try {
      for (const f of Array.from(lista)) {
        const { blob, nome } = await prepararArquivo(f);
        onEstado(await enviarArquivo(codigo, tipo, blob, nome));
      }
    } catch (e) {
      setErro(e instanceof ErroFicha ? e.message : "Não foi possível enviar. Tente de novo.");
    } finally {
      setEnviando(false);
      if (camera.current) camera.current.value = "";
      if (galeria.current) galeria.current.value = "";
    }
  }

  async function apagar(id: string) {
    setErro(null);
    try { onEstado(await apagarArquivo(codigo, id)); } catch (e) { setErro(e instanceof ErroFicha ? e.message : "Não foi possível apagar."); }
  }

  const feito = arquivos.length > 0;
  return (
    <section className={`fp-slot${feito ? " fp-slot--feito" : ""}`} aria-labelledby={`slot-${tipo}`}>
      <header className="fp-slot-topo">
        <span className="fp-slot-marca" aria-hidden="true">{feito ? <Check size={16} /> : null}</span>
        <div>
          <h3 id={`slot-${tipo}`} className="fp-slot-titulo">{rotulo}{obrigatorio && <span className="fp-selo">obrigatório</span>}</h3>
          {DICAS[tipo] && <p className="fp-dica">{DICAS[tipo]}</p>}
        </div>
      </header>

      {feito && (
        <ul className="fp-arquivos">
          {arquivos.map((a) => (
            <li key={a.id} className="fp-arquivo">
              <Miniatura codigo={codigo} arquivo={a} />
              <span className="fp-arquivo-nome">{a.nomeOriginal}<small>{tamanhoLegivel(a.tamanho)}</small></span>
              <button type="button" className="fp-icone" onClick={() => apagar(a.id)} aria-label={`Apagar ${a.nomeOriginal}`}><Trash2 size={18} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="fp-slot-acoes">
        <button type="button" className="fp-botao fp-botao--secundario" onClick={() => camera.current?.click()} disabled={enviando}>
          {enviando ? <Loader2 size={18} className="fp-girando" aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
          {enviando ? "Enviando…" : feito ? "Tirar outra foto" : "Tirar foto"}
        </button>
        <button type="button" className="fp-botao fp-botao--linha" onClick={() => galeria.current?.click()} disabled={enviando}>
          <ImagePlus size={18} aria-hidden="true" /> Escolher arquivo
        </button>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => enviar(e.target.files)} />
        <input ref={galeria} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => enviar(e.target.files)} />
      </div>
      {erro && <p className="fp-erro" role="alert">{erro}</p>}
    </section>
  );
}

export function EtapaFotos({ codigo, tipo, tipos, obrigatorios, arquivos, onEstado }: Props) {
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
          arquivos={arquivos.filter((a) => a.tipo === t)} onEstado={onEstado} />
      ))}
    </div>
  );
}
