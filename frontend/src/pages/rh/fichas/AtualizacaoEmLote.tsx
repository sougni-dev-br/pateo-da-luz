// Pede a ficha de atualização a todos os funcionários ativos de uma vez. Os links só existem
// na resposta (o banco guarda o hash): a lista fica aberta até o RH mandar um por um.
import { Check, Copy, MessageCircle, Users } from "lucide-react";
import { useState } from "react";
import { pedirAtualizacaoEmLote, type FichaLoteResultado } from "../../../api/client";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button } from "../../../design-system";
import { copiarTexto, dataBr, linkDaFicha, linkWhatsapp } from "./fichaFormato";

type Props = { onGeradas: () => void };

export function AtualizacaoEmLote({ onGeradas }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<FichaLoteResultado | null>(null);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  const [copiado, setCopiado] = useState<string | null>(null);
  const [semCopiar, setSemCopiar] = useState<string | null>(null);

  async function gerar() {
    setConfirmando(false);
    setGerando(true);
    setErro(null);
    try {
      setResultado(await pedirAtualizacaoEmLote());
      setEnviados(new Set());
      onGeradas();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gerar os links.");
    } finally {
      setGerando(false);
    }
  }

  async function copiar(fichaId: string, url: string) {
    // Só conta como enviado se copiou de verdade: o link não aparece de novo depois de fechar.
    if (!(await copiarTexto(url))) { setSemCopiar(url); return; }
    setSemCopiar(null);
    setCopiado(fichaId);
    setEnviados((a) => new Set(a).add(fichaId));
    window.setTimeout(() => setCopiado((atual) => (atual === fichaId ? null : atual)), 2500);
  }

  function fechar() {
    const faltam = (resultado?.criadas.length ?? 0) - enviados.size;
    if (faltam > 0 && !window.confirm(`${faltam} link(s) ainda não foram enviados nem copiados. Depois de fechar, só gerando um novo link em cada ficha. Fechar mesmo assim?`)) return;
    setResultado(null);
  }

  return (
    <>
      <Button variant="secondary" leadingIcon={<Users size={16} />} disabled={gerando} onClick={() => setConfirmando(true)}>
        {gerando ? "Gerando links…" : "Pedir atualização a todos os ativos"}
      </Button>
      {erro && <Alert tone="error">{erro}</Alert>}

      <ConfirmDialog open={confirmando} title="Pedir atualização a todos os ativos?" confirmLabel="Gerar os links" cancelLabel="Voltar"
        description="Gera uma ficha de atualização, já preenchida com o cadastro, para cada funcionário ativo. Quem já tem ficha aberta fica de fora. Em seguida aparece a lista para mandar cada link pelo WhatsApp."
        onCancel={() => setConfirmando(false)} onConfirm={gerar} />

      <Dialog open={resultado !== null} onOpenChange={(v) => { if (!v) fechar(); }} title="Links de atualização"
        description={resultado ? `${resultado.criadas.length} link(s) gerado(s)${resultado.criadas[0] ? `, valem até ${dataBr(resultado.criadas[0].expiraEm)}` : ""}.` : undefined}>
        {resultado && (
          <div className="fc-lote">
            <Alert tone="warning">Os links aparecem só agora. Mande cada um antes de fechar esta janela.</Alert>
            {semCopiar && (
              <Alert tone="error">O navegador não deixou copiar. Selecione e copie este link: <code className="fc-lote-url">{semCopiar}</code></Alert>
            )}
            {resultado.criadas.length > 0 && (
              <ul className="fc-lote-lista">
                {resultado.criadas.map((c) => {
                  const url = linkDaFicha(c.codigo);
                  const enviado = enviados.has(c.fichaId);
                  return (
                    <li key={c.fichaId} className={enviado ? "fc-lote-item fc-lote-item--feito" : "fc-lote-item"}>
                      <span className="fc-lote-nome">
                        {enviado && <Check size={15} aria-label="Enviado" />}
                        <strong>{c.nome}</strong>
                        {!c.celular && <small>sem celular no cadastro</small>}
                      </span>
                      <span className="fc-lote-acoes">
                        <a className="fc-botao-whats fc-botao-whats--compacto" href={linkWhatsapp(c.nome, url, "ATUALIZACAO", c.celular)} target="_blank" rel="noopener noreferrer"
                          onClick={() => setEnviados((a) => new Set(a).add(c.fichaId))}>
                          <MessageCircle size={16} aria-hidden="true" /> WhatsApp
                        </a>
                        <Button variant="secondary" size="sm" leadingIcon={copiado === c.fichaId ? <Check size={15} /> : <Copy size={15} />} onClick={() => copiar(c.fichaId, url)}>
                          {copiado === c.fichaId ? "Copiado" : "Copiar link"}
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {resultado.jaAbertas.length > 0 && (
              <p className="fc-vazio">Já tinham ficha aberta (use “Gerar novo link” na ficha, se precisar): {resultado.jaAbertas.map((j) => j.nome).join(", ")}.</p>
            )}
            <div className="fc-lote-rodape">
              {resultado.criadas.length > 0 && <span>{enviados.size} de {resultado.criadas.length} enviado(s) ou copiado(s)</span>}
              <Button onClick={fechar}>Fechar</Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
