import { Check, Copy, MessageCircle } from "lucide-react";
import { useState } from "react";
import type { FichaCadastralTipo } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, TextField } from "../../../design-system";
import { dataBr, linkDaFicha, linkWhatsapp } from "./fichaFormato";

type Props = {
  aberto: boolean;
  onFechar: () => void;
  nome: string;
  tipo: FichaCadastralTipo;
  codigo: string;
  expiraEm: string;
  celular?: string | null;
};

/**
 * O código do link só existe aqui: o banco guarda o hash. Fechou sem copiar, só gerando
 * outro link — por isso o aviso.
 */
export function LinkFicha({ aberto, onFechar, nome, tipo, codigo, expiraEm, celular }: Props) {
  const url = linkDaFicha(codigo);
  const [copiado, setCopiado] = useState(false);
  const [numero, setNumero] = useState(celular ?? "");

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const campo = document.getElementById("ficha-link-url") as HTMLInputElement | null;
      campo?.select();
      document.execCommand?.("copy");
    }
    setCopiado(true);
    window.setTimeout(() => setCopiado(false), 2500);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onFechar(); }} title={`Link da ficha de ${nome.split(" ")[0]}`}
      description={`Vale até ${dataBr(expiraEm)}. Quem tiver o link preenche a ficha — mande só para a pessoa.`}>
      <div className="fc-link">
        <TextField id="ficha-link-url" label="Link" value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        <div className="fc-link-acoes">
          <Button variant="secondary" leadingIcon={copiado ? <Check size={16} /> : <Copy size={16} />} onClick={copiar}>
            {copiado ? "Copiado" : "Copiar link"}
          </Button>
        </div>
        <div className="fc-link-whats">
          <TextField label="Celular da pessoa (opcional)" hint="Com DDD. Sem número, o WhatsApp pede para escolher a conversa." inputMode="numeric"
            value={numero} onChange={(e) => setNumero(e.target.value)} />
          <a className="fc-botao-whats" href={linkWhatsapp(nome, url, tipo, numero)} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={18} aria-hidden="true" /> Enviar pelo WhatsApp
          </a>
        </div>
        <Alert tone="warning">Este link aparece só agora. Se fechar sem enviar, use “Gerar novo link” na ficha.</Alert>
      </div>
    </Dialog>
  );
}
