// Termo de rescisão (TRCT) com líquido zero: as faltas e os descontos consumiram tudo e
// não há o que pagar. Lê o PDF, mostra o que achou e, confirmado, registra a rescisão como
// quitada no termo (R$ 0,00, paga na data do termo, fora do Contas a Pagar).
// O arquivo não é guardado: só os valores e a impressão digital (SHA-256) dele.
import { ArrowRight, Check, FileUp, X } from "lucide-react";
import { useRef, useState } from "react";
import { type TermoSemValorPrevia, registrarTermoSemValor } from "../../../api/client";
import { Alert, Button, Money } from "../../../design-system";

type Props = {
  employeeId: string;
  nome: string;
  onQuitou: () => void;
  /** Termo com líquido a pagar: segue para o lançamento normal (passo 4). */
  onLancarNormal: () => void;
};

const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

const lerComoBase64 = (arquivo: File) => new Promise<string>((ok, falha) => {
  const leitor = new FileReader();
  leitor.onload = () => ok(String(leitor.result));
  leitor.onerror = () => falha(new Error("Não foi possível abrir o arquivo."));
  leitor.readAsDataURL(arquivo);
});

export function TermoSemValor({ employeeId, nome, onQuitou, onLancarNormal }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [previa, setPrevia] = useState<TermoSemValorPrevia | null>(null);
  const [conteudo, setConteudo] = useState<{ base64: string; nome: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const limpar = () => { setPrevia(null); setConteudo(null); setConfirmando(false); };

  async function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    limpar();
    try {
      const base64 = await lerComoBase64(arquivo);
      const r = await registrarTermoSemValor(employeeId, base64, arquivo.name, false);
      setConteudo({ base64, nome: arquivo.name });
      setPrevia(r.previa);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui ler o termo.");
    } finally {
      setOcupado(false);
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function quitar() {
    if (!conteudo) return;
    setOcupado(true);
    setErro(null);
    try {
      await registrarTermoSemValor(employeeId, conteudo.base64, conteudo.nome, true);
      limpar();
      onQuitou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui registrar a rescisão.");
      setConfirmando(false);
    } finally {
      setOcupado(false);
    }
  }

  const liquidoAPagar = previa?.liquido != null && previa.liquido > 0;

  return (
    <div className="rr-termo-zero">
      <input ref={entrada} type="file" accept="application/pdf" hidden aria-label="PDF do termo de rescisão" onChange={(e) => void escolher(e.target.files?.[0])} />
      {!previa && (
        <Button variant="secondary" leadingIcon={<FileUp size={14} />} disabled={ocupado} onClick={() => entrada.current?.click()}>
          {ocupado ? "Lendo…" : "Enviar o termo (PDF)"}
        </Button>
      )}
      {erro && <Alert tone="error">{erro}</Alert>}

      {previa && (
        <div className="recibo-previa" role="region" aria-label="Termo de rescisão lido">
          <div className="recibo-previa-topo">
            <strong>{previa.nomeNoTermo ?? nome}</strong>
            <span className="rr-ajuda">{previa.arquivo}</span>
          </div>
          <dl className="fechamento-grade">
            <div><dt>Afastamento</dt><dd>{dataBr(previa.afastamento)}</dd></div>
            <div><dt>Pagamento da rescisão</dt><dd>{dataBr(previa.pagamento)}</dd></div>
            <div><dt>Total bruto</dt><dd>{previa.totalBruto == null ? "—" : <Money value={previa.totalBruto} />}</dd></div>
            <div><dt>Líquido no termo</dt><dd>{previa.liquido == null ? "não lido" : <Money value={previa.liquido} />}</dd></div>
          </dl>
          {previa.divergencias.length > 0 && (
            <ul className="recibo-divergencias">
              {previa.divergencias.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
          {previa.recusa && <Alert tone="warning">{previa.recusa}</Alert>}

          {previa.podeQuitar && !confirmando && (
            <div className="barra-lista">
              <Button leadingIcon={<Check size={14} />} disabled={ocupado} onClick={() => setConfirmando(true)}>Marcar como quitada no termo</Button>
              <Button variant="secondary" leadingIcon={<X size={14} />} disabled={ocupado} onClick={limpar}>Cancelar</Button>
            </div>
          )}
          {previa.podeQuitar && confirmando && (
            <div className="rr-termo-zero-confirmar">
              <p className="rr-ajuda" style={{ margin: 0 }}>
                Registra a rescisão de {nome} com valor <Money value={0} />, paga em {dataBr(previa.pagamento ?? previa.afastamento)}.
                Não entra no Contas a Pagar. Dá para desfazer depois, excluindo o registro.
              </p>
              <div className="barra-lista">
                <Button leadingIcon={<Check size={14} />} disabled={ocupado} onClick={() => void quitar()}>
                  {ocupado ? "Gravando…" : "Confirmar: quitada no termo"}
                </Button>
                <Button variant="secondary" disabled={ocupado} onClick={() => setConfirmando(false)}>Voltar</Button>
              </div>
            </div>
          )}
          {!previa.podeQuitar && (
            <div className="barra-lista">
              {liquidoAPagar && (
                <Button onClick={onLancarNormal}>Lançar a rescisão (passo 4) <ArrowRight size={14} aria-hidden="true" /></Button>
              )}
              <Button variant="secondary" leadingIcon={<X size={14} />} onClick={limpar}>Escolher outro PDF</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
