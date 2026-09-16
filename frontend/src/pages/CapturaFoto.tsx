import { Camera, Check, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Alert, Button } from "../design-system";
import "./DocIntake.css";

/**
 * Resolução pedida à câmera. Alta de propósito: o que se fotografa aqui é
 * número de nota fiscal, e dígito borrado vira valor errado na contabilidade.
 * É um "ideal" — a câmera entrega o que conseguir.
 */
const RESOLUCAO = { width: { ideal: 2560 }, height: { ideal: 1440 } };
const QUALIDADE_JPEG = 0.92;

type FotoCapturada = { dataUrl: string; nome: string };

type Props = {
  aberto: boolean;
  onFechar: () => void;
  onConfirmar: (fotos: File[]) => void;
  maximo: number;
};

function dataUrlParaFile(dataUrl: string, nome: string): File {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binario = atob(base64);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return new File([bytes], nome, { type: "image/jpeg" });
}

/**
 * Câmera para fotografar documento, com preview.
 *
 * Preview dentro da tela, e não o app de câmera do sistema, porque aqui se
 * fotografa papel: dá para conferir o enquadramento antes de gastar uma leitura,
 * e dá para tirar a nota e os boletos em sequência sem sair da tela.
 *
 * Desenho de scanner: visor grande, guias nos cantos e obturador embaixo, onde
 * o polegar alcança.
 */
export function CapturaFoto({ aberto, onFechar, onConfirmar, maximo }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [fotos, setFotos] = useState<FotoCapturada[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pronta, setPronta] = useState(false);
  /** Proporção real entregue pela câmera, para a moldura enquadrar a imagem. */
  const [proporcao, setProporcao] = useState("16 / 9");
  const proporcaoCss = { "--proporcao-camera": proporcao } as CSSProperties;

  const desligarCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setPronta(false);
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;

    let cancelado = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setErro("Este navegador não permite acessar a câmera. Use o botão de escolher arquivo.");
          return;
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          // environment = câmera traseira no celular, que é a que fotografa papel.
          video: { facingMode: { ideal: "environment" }, ...RESOLUCAO },
          audio: false,
        });
        if (cancelado) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setPronta(true);
        setErro(null);
      } catch (falha) {
        const nome = (falha as Error).name;
        setErro(
          nome === "NotAllowedError"
            ? "Permissão de câmera negada. Libere o acesso no navegador e tente de novo."
            : nome === "NotFoundError"
              ? "Nenhuma câmera encontrada neste aparelho."
              : `Não foi possível abrir a câmera: ${(falha as Error).message}`,
        );
      }
    })();

    return () => {
      cancelado = true;
      desligarCamera();
    };
  }, [aberto, desligarCamera]);

  // Esc fecha — o gesto que todo mundo tenta primeiro.
  useEffect(() => {
    if (!aberto) return undefined;
    const aoTeclar = (evento: KeyboardEvent) => { if (evento.key === "Escape") fechar(); };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  function capturar() {
    const video = videoRef.current;
    if (!video || !pronta) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const contexto = canvas.getContext("2d");
    if (!contexto) return;
    contexto.drawImage(video, 0, 0);

    const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    setFotos((atual) => [
      ...atual,
      { dataUrl: canvas.toDataURL("image/jpeg", QUALIDADE_JPEG), nome: `foto-${carimbo}-${atual.length + 1}.jpg` },
    ]);
  }

  function confirmar() {
    onConfirmar(fotos.map((foto) => dataUrlParaFile(foto.dataUrl, foto.nome)));
    setFotos([]);
    onFechar();
  }

  function fechar() {
    setFotos([]);
    onFechar();
  }

  if (!aberto) return null;

  const atingiuMaximo = fotos.length >= maximo;

  return createPortal(
    <div className="doc-camera" role="dialog" aria-label="Tirar foto do documento">
      <div className="doc-camera__topo">
        <Camera size={16} />
        Tirar foto do documento
        <button type="button" className="doc-camera__fechar" onClick={fechar} aria-label="Fechar câmera">
          <X size={18} />
        </button>
      </div>

      <div className="doc-camera__visor">
        {erro ? (
          <div style={{ maxWidth: 460, padding: 16 }}><Alert tone="error">{erro}</Alert></div>
        ) : (
          <div className="doc-camera__quadro" style={proporcaoCss}>
            <video
              ref={videoRef}
              playsInline
              muted
              onLoadedMetadata={(evento) => {
                const alvo = evento.currentTarget;
                if (alvo.videoWidth && alvo.videoHeight) setProporcao(`${alvo.videoWidth} / ${alvo.videoHeight}`);
              }}
            />
            <div className="doc-camera__guia"><span /></div>
          </div>
        )}
      </div>

      <div className="doc-camera__base">
        {fotos.length > 0 && (
          <div className="doc-camera__tiras">
            {fotos.map((foto, indice) => (
              <div key={foto.nome} className="doc-camera__miniatura">
                <img src={foto.dataUrl} alt={`Foto ${indice + 1}`} />
                <button
                  type="button"
                  className="doc-camera__descartar"
                  aria-label={`Descartar foto ${indice + 1}`}
                  onClick={() => setFotos((atual) => atual.filter((_, i) => i !== indice))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <p className="doc-camera__dica">
          Encaixe o documento inteiro na moldura, de frente e sem sombra sobre os números.
          {maximo > 1 && " Pode fotografar a nota e os boletos em sequência."}
        </p>

        <div className="doc-camera__controles">
          <span className="doc-camera__contador">{fotos.length} de {maximo}</span>

          <button
            type="button"
            className="doc-camera__obturador"
            onClick={capturar}
            disabled={!pronta || atingiuMaximo || !!erro}
            aria-label={atingiuMaximo ? `Limite de ${maximo} fotos atingido` : "Tirar foto"}
            title={atingiuMaximo ? `Limite de ${maximo} fotos` : "Tirar foto"}
          >
            <Camera size={26} />
          </button>

          <div className="doc-camera__usar" style={{ display: "flex", gap: 8 }}>
            {fotos.length > 0 && (
              <>
                <Button variant="secondary" onClick={() => setFotos([])} leadingIcon={<RotateCcw size={14} />}>
                  Limpar
                </Button>
                <Button onClick={confirmar} leadingIcon={<Check size={15} />}>
                  Usar {fotos.length === 1 ? "foto" : `as ${fotos.length}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
