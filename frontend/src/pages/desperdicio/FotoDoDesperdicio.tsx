import { Camera, ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getWastePhoto } from "../../api/client";
import { Dialog } from "../../components/ui/Dialog";

type SeletorProps = {
  arquivo: File | null;
  onEscolher: (arquivo: File | null) => void;
  desabilitado?: boolean;
};

/** Foto opcional do lançamento. O celular oferece câmera e galeria; o computador, o seletor de arquivos. */
export function SeletorDeFoto({ arquivo, onEscolher, desabilitado }: SeletorProps) {
  const entrada = useRef<HTMLInputElement>(null);
  const botaoEscolher = useRef<HTMLButtonElement>(null);
  const botaoRemover = useRef<HTMLButtonElement>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const tinhaArquivo = useRef(false);

  useEffect(() => {
    if (!arquivo) { setPrevia(null); return undefined; }
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  // O botão que estava focado some quando a foto entra ou sai: o foco vai para o que o substitui.
  useEffect(() => {
    if (arquivo && previa) botaoRemover.current?.focus();
    else if (tinhaArquivo.current && !arquivo) botaoEscolher.current?.focus();
    tinhaArquivo.current = Boolean(arquivo);
  }, [arquivo, previa]);

  return (
    <div className="waste-field">
      <span className="waste-label">Foto (opcional)</span>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        hidden
        data-testid="foto-desperdicio"
        onChange={(event) => {
          onEscolher(event.target.files?.[0] ?? null);
          // Permite escolher o mesmo arquivo de novo depois de remover.
          event.target.value = "";
        }}
      />
      {arquivo && previa ? (
        <div className="waste-photo-picked">
          <img src={previa} alt="Prévia da foto do desperdício" />
          <button ref={botaoRemover} type="button" className="waste-picked-clear" aria-label="Remover foto" onClick={() => onEscolher(null)} disabled={desabilitado}>
            <X size={16} />
          </button>
        </div>
      ) : (
        <button ref={botaoEscolher} type="button" className="waste-photo-btn" onClick={() => entrada.current?.click()} disabled={desabilitado}>
          <Camera size={18} aria-hidden /> Tirar ou escolher foto
        </button>
      )}
    </div>
  );
}

type AnexarProps = { rotulo: string; onEscolher: (arquivo: File) => void; ocupado: boolean };

/** "Anexar foto" numa linha que ficou sem foto (envio que falhou, ou foto que não deu para tirar na hora). */
export function BotaoAnexarFoto({ rotulo, onEscolher, ocupado }: AnexarProps) {
  const entrada = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        hidden
        aria-label={rotulo}
        onChange={(event) => {
          const arquivo = event.target.files?.[0];
          event.target.value = "";
          if (arquivo) onEscolher(arquivo);
        }}
      />
      <button type="button" className="waste-link" disabled={ocupado} onClick={() => entrada.current?.click()}>
        <Camera size={13} aria-hidden /> {ocupado ? "Enviando foto…" : "Anexar foto"}
      </button>
    </>
  );
}

type VisualizadorProps = { lancamentoId: string; titulo: string; onFechar: () => void };

/** Mostra a foto de um lançamento. A imagem vem com o token, então é buscada como arquivo e não como <img src>. */
export function VisualizadorDeFoto({ lancamentoId, titulo, onFechar }: VisualizadorProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let atual = true;
    let criada: string | null = null;
    getWastePhoto(lancamentoId)
      .then((blob) => {
        if (!atual) return;
        criada = URL.createObjectURL(blob);
        setUrl(criada);
      })
      .catch(() => { if (atual) setErro("Não foi possível abrir a foto agora. Tente de novo; se continuar, ela pode ter expirado (as fotos ficam guardadas por 90 dias)."); });
    return () => {
      atual = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [lancamentoId]);

  return (
    <Dialog open onOpenChange={(aberto) => { if (!aberto) onFechar(); }} title="Foto do desperdício" description={titulo} size="md">
      {erro ? <p className="waste-error" role="alert">{erro}</p>
        : url ? <img className="waste-photo-view" src={url} alt={`Foto do desperdício: ${titulo}`} />
        : <p className="waste-note"><ImageIcon size={14} aria-hidden /> Carregando foto…</p>}
    </Dialog>
  );
}
