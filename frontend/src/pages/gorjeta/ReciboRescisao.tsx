// Termo de rescisão (TRCT) que volta da contabilidade: lê o PDF, mostra o que
// achou (gorjeta paga, datas) e, confirmado, grava a gorjeta como valor quitado.
// O arquivo não é guardado: só os valores e a impressão digital (SHA-256) dele.
import { Check, FileUp, X } from "lucide-react";
import { useRef, useState } from "react";
import { type TipComputation, type TipReciboPrevia, lerReciboRescisao } from "../../api/client";
import { Button, StatusBadge } from "../../design-system";
import { money, mutedStyle } from "./gorjetaUtils";

type Props = {
  year: number;
  month: number;
  readonly: boolean;
  /** Termina o salvamento automático antes de gravar (senão ele sobrescreveria o valor). */
  antesDeGravar: () => Promise<void>;
  onAplicado: (c: TipComputation) => void;
  onErro: (mensagem: string) => void;
};

const diaCompleto = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

const lerComoBase64 = (arquivo: File) => new Promise<string>((ok, falha) => {
  const leitor = new FileReader();
  leitor.onload = () => ok(String(leitor.result));
  leitor.onerror = () => falha(new Error("Não foi possível abrir o arquivo."));
  leitor.readAsDataURL(arquivo);
});

export function ReciboRescisao({ year, month, readonly, antesDeGravar, onAplicado, onErro }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<TipReciboPrevia | null>(null);
  const [conteudo, setConteudo] = useState<{ base64: string; nome: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setOcupado(true);
    try {
      const base64 = await lerComoBase64(arquivo);
      const r = await lerReciboRescisao(year, month, base64, arquivo.name, false);
      setConteudo({ base64, nome: arquivo.name });
      setPrevia(r.previa);
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function aplicar() {
    if (!conteudo) return;
    setOcupado(true);
    try {
      await antesDeGravar();
      const r = await lerReciboRescisao(year, month, conteudo.base64, conteudo.nome, true);
      if (r.computation) onAplicado(r.computation);
      setPrevia(null);
      setConteudo(null);
    } catch (e) {
      onErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="recibo-rescisao">
      {!readonly && (
        <>
          <input ref={entrada} type="file" accept="application/pdf" hidden onChange={(e) => void escolher(e.target.files?.[0])} />
          <Button variant="secondary" leadingIcon={<FileUp size={14} />} disabled={ocupado} onClick={() => entrada.current?.click()}>
            {ocupado && !previa ? "Lendo…" : "Ler termo de rescisão (PDF)"}
          </Button>
          <span style={mutedStyle}>O retorno da contabilidade já traz a gorjeta paga: ela vira o valor quitado e sai da lista a pagar.</span>
        </>
      )}
      {previa && (
        <div className="recibo-previa" role="region" aria-label="Termo de rescisão lido">
          <div className="recibo-previa-topo">
            <strong>{previa.nome}</strong>
            <span style={mutedStyle}>{previa.arquivo}</span>
          </div>
          <dl className="fechamento-grade">
            <div><dt>Gorjeta no termo</dt><dd>{previa.gorjeta == null ? "não encontrada" : money(previa.gorjeta)}</dd></div>
            <div><dt>Saída</dt><dd>{diaCompleto(previa.afastamento)}</dd></div>
            <div><dt>Admissão</dt><dd>{diaCompleto(previa.admissao)}</dd></div>
            <div><dt>Pagamento da rescisão</dt><dd>{diaCompleto(previa.pagamento)}</dd></div>
            <div><dt>Líquido da rescisão</dt><dd>{money(previa.liquido)}</dd></div>
          </dl>
          {previa.divergencias.length > 0 && (
            <ul className="recibo-divergencias">
              {previa.divergencias.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
          <div className="barra-lista">
            <Button leadingIcon={<Check size={14} />} disabled={ocupado || previa.gorjeta == null} onClick={() => void aplicar()}>
              {ocupado ? "Gravando…" : `Usar ${money(previa.gorjeta)} como gorjeta quitada`}
            </Button>
            <Button variant="secondary" leadingIcon={<X size={14} />} disabled={ocupado} onClick={() => { setPrevia(null); setConteudo(null); }}>Cancelar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SeloRecibo({ pago, pagamento, arquivo }: { pago: boolean; pagamento: string | null; arquivo?: string }) {
  if (!pago) return null;
  return (
    <StatusBadge tone="success" title={arquivo ? `Termo: ${arquivo}` : undefined}>
      Paga na rescisão{pagamento ? ` · ${diaCompleto(pagamento)}` : ""}
    </StatusBadge>
  );
}
