// Passo 2: o que o sistema apurou. Sem registro: salário, gorjeta, hora extra, vales,
// adiantamento/quinzena e VT, calculados aqui. CLT: o bruto vem do termo (TRCT) da
// contabilidade — importa-se o PDF e o sistema mostra o que ele trouxe.
import { useState } from "react";
import { type ApuracaoRescisao, type DetalheRescisao, type TerminationInfo, deletePayrollItem } from "../../../api/client";
import { ApuracaoRescisaoPainel } from "../../../components/pessoal/ApuracaoRescisao";
import { useSession } from "../../../context/SessionContext";
import { Alert, Button, FormField, Money, Textarea } from "../../../design-system";
import { hasPermission } from "../../../lib/permissions";
import { ReciboRescisao } from "../../gorjeta/ReciboRescisao";
import "../../gorjeta/gorjeta.css";
import { TermoSemValor } from "./TermoSemValor";

const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

type Props = { detalhe: DetalheRescisao; info: TerminationInfo | null; carregando: boolean; onMudou: () => void; onLancarNormal: () => void };

function DestaqueSemRegistro({ a }: { a: ApuracaoRescisao }) {
  const s = a.sugestao;
  const liquido = s.bruto == null ? null : Math.round((s.bruto - s.vales - s.vtDesconto) * 100) / 100;
  return (
    <dl className="rr-destaque">
      <div><dt>Salário proporcional</dt><dd>{s.salario == null ? "—" : <Money value={s.salario} />}</dd></div>
      <div><dt>Gorjeta até a saída</dt><dd>{s.gorjeta == null ? "pendente" : <Money value={s.gorjeta} />}</dd></div>
      {s.creditos > 0 && <div><dt>Créditos e hora extra</dt><dd><Money value={s.creditos} /></dd></div>}
      <div><dt>Vales, adiantamento e quinzena</dt><dd>{s.vales > 0 ? <>− <Money value={s.vales} /></> : <Money value={0} />}</dd></div>
      <div><dt>VT pago para depois da saída</dt><dd>{s.vtDesconto > 0 ? <>− <Money value={s.vtDesconto} /></> : <Money value={0} />}</dd></div>
      <div className="rr-destaque-total"><dt>Líquido apurado</dt><dd>{liquido == null ? "falta a gorjeta" : <Money value={liquido} />}</dd></div>
    </dl>
  );
}

const MOTIVO_MINIMO = 3;

// Rescisão já registrada como quitada no termo: o que ficou gravado e como desfazer.
function QuitadaNoTermo({ detalhe, itemId, onMudou }: { detalhe: DetalheRescisao; itemId: string; onMudou: () => void }) {
  const { user } = useSession();
  const podeExcluir = hasPermission(user, "payroll", "delete");
  const [desfazendo, setDesfazendo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const termo = detalhe.pessoa.termo;

  async function desfazer() {
    if (motivo.trim().length < MOTIVO_MINIMO) { setErro(`Explique em pelo menos ${MOTIVO_MINIMO} letras.`); return; }
    setOcupado(true);
    setErro(null);
    try {
      await deletePayrollItem(itemId, motivo.trim());
      setDesfazendo(false);
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui desfazer.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="resc-quadro resc-quadro--ok">
      <strong>Rescisão quitada no termo: nada a pagar</strong>
      <dl className="rr-termo" style={{ marginTop: 8 }}>
        <div><dt>Líquido no termo</dt><dd><Money value={0} /></dd></div>
        <div><dt>Pagamento da rescisão</dt><dd>{dataBr(termo?.pagamento ?? null)}</dd></div>
        <div><dt>Arquivo</dt><dd>{termo?.arquivo ?? "—"}{termo?.importadoEm ? ` · registrado em ${dataBr(termo.importadoEm)}` : ""}</dd></div>
      </dl>
      <p className="rr-ajuda" style={{ marginTop: 8 }}>
        O termo da contabilidade fechou com líquido zero. A rescisão fica registrada na Folha com <Money value={0} />, paga na data do termo, e não aparece no Contas a Pagar.
      </p>
      {!desfazendo && (
        <Button size="sm" variant="secondary" disabled={!podeExcluir} onClick={() => setDesfazendo(true)}
          title={podeExcluir ? undefined : "Desfazer exige a permissão de excluir na Folha"}>
          Desfazer (excluir o registro)
        </Button>
      )}
      {desfazendo && (
        <div className="rr-pendencia-confirmar">
          <FormField label="Motivo (fica na auditoria)" required error={erro ?? undefined}>
            <Textarea rows={2} value={motivo} onChange={(e) => { setMotivo(e.target.value); setErro(null); }} autoFocus />
          </FormField>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="danger" onClick={() => void desfazer()} disabled={ocupado}>{ocupado ? "Desfazendo…" : "Confirmar: desfazer"}</Button>
            <Button size="sm" variant="secondary" onClick={() => { setDesfazendo(false); setErro(null); }} disabled={ocupado}>Voltar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Termo com líquido zero (sem gorjeta, ou a pessoa fora da apuração): registra como quitada.
function QuadroTermoZero({ detalhe, titulo, texto, onMudou, onLancarNormal }: {
  detalhe: DetalheRescisao; titulo: string; texto: string; onMudou: () => void; onLancarNormal: () => void;
}) {
  return (
    <div className="resc-quadro">
      <strong>{titulo}</strong>
      <p className="rr-ajuda" style={{ margin: "4px 0 8px" }}>{texto}</p>
      <TermoSemValor employeeId={detalhe.pessoa.employeeId} nome={detalhe.pessoa.nome} onQuitou={onMudou} onLancarNormal={onLancarNormal} />
    </div>
  );
}

const TEXTO_TERMO_ZERO = "Envie o PDF do termo da contabilidade. Se o líquido for zero (as faltas e os descontos consumiram tudo), a rescisão fica quitada no termo: sem nada a pagar e fora do Contas a Pagar. Com líquido a pagar, lance a rescisão normal no passo 4. O arquivo não é guardado.";

function TermoCLT({ detalhe, onMudou, onLancarNormal }: { detalhe: DetalheRescisao; onMudou: () => void; onLancarNormal: () => void }) {
  const { user } = useSession();
  const podeGorjeta = hasPermission(user, "payroll-tips", "edit");
  const [erro, setErro] = useState<string | null>(null);
  const termo = detalhe.pessoa.termo;
  const periodo = detalhe.periodoGorjeta;
  const rescisao = detalhe.pessoa.rescisao;

  if (rescisao?.quitadaNoTermo) {
    return <QuitadaNoTermo detalhe={detalhe} itemId={rescisao.quitadaNoTermo.itemId} onMudou={onMudou} />;
  }
  // Ainda sem rescisão lançada: dá para registrar como quitada no termo.
  const termoZero = (titulo: string) => (rescisao ? null : (
    <QuadroTermoZero detalhe={detalhe} titulo={titulo} texto={TEXTO_TERMO_ZERO} onMudou={onMudou} onLancarNormal={onLancarNormal} />
  ));

  if (!periodo || !periodo.participa) {
    return (
      <>
        <p className="rr-ajuda" style={{ margin: 0 }}>
          {periodo
            ? `${detalhe.pessoa.nome} não está na apuração de gorjeta de ${periodo.label}: o termo não tem gorjeta a importar lá.`
            : "Não há período de gorjeta com a data de saída: o termo não tem gorjeta a importar."}
        </p>
        {termoZero("Enviar o termo de rescisão (TRCT)") ?? <Alert tone="info">A rescisão já foi lançada: confira no passo 4.</Alert>}
      </>
    );
  }

  if (termo) {
    return (
      <>
      <div className="resc-quadro resc-quadro--ok">
        <strong>O termo (TRCT) já foi importado</strong>
        <dl className="rr-termo" style={{ marginTop: 8 }}>
          <div><dt>Gorjeta no termo (quitada)</dt><dd>{termo.gorjeta == null ? "—" : <Money value={termo.gorjeta} />}</dd></div>
          <div><dt>Líquido no termo</dt><dd>{termo.liquido == null ? "—" : <Money value={termo.liquido} />}</dd></div>
          <div><dt>Pagamento da rescisão</dt><dd>{dataBr(termo.pagamento)}</dd></div>
          <div><dt>Arquivo</dt><dd>{termo.arquivo ?? "—"}{termo.importadoEm ? ` · lido em ${dataBr(termo.importadoEm)}` : ""}</dd></div>
        </dl>
        <p className="rr-ajuda" style={{ marginTop: 8 }}>A lista de pagamento da gorjeta do mês já marca &quot;pago na rescisão&quot;. O bruto do termo é o que se lança no passo 4.</p>
      </div>
      {termo.liquido === 0 && termoZero("Líquido zero no termo: nada a lançar")}
      </>
    );
  }
  return (
    <>
    <div className="resc-quadro">
      <strong>Importar o termo de rescisão (TRCT)</strong>
      <p className="rr-ajuda" style={{ margin: "4px 0 8px" }}>
        O PDF que a contabilidade manda. O sistema lê a gorjeta paga e as datas, grava a gorjeta como quitada na apuração de {periodo.label}
        {" "}e a lista do mês marca &quot;pago na rescisão&quot;. O arquivo não é guardado.
      </p>
      {!podeGorjeta && <Alert tone="info">Ler o termo grava na Apuração de gorjeta: exige a permissão de editar a Gorjeta.</Alert>}
      {erro && <Alert tone="error">{erro}</Alert>}
      {periodo.fechado && <Alert tone="warning">A apuração de {periodo.label} está fechada: reabra para gravar o termo.</Alert>}
      <ReciboRescisao
        year={periodo.year}
        month={periodo.month}
        readonly={!podeGorjeta || periodo.fechado}
        antesDeGravar={async () => undefined}
        onAplicado={() => { setErro(null); onMudou(); }}
        onErro={setErro}
        esperado={{ employeeId: detalhe.pessoa.employeeId, nome: detalhe.pessoa.nome }}
      />
    </div>
    {termoZero("O termo veio sem gorjeta e com líquido zero?")}
    </>
  );
}

export function PassoApuracao({ detalhe, info, carregando, onMudou, onLancarNormal }: Props) {
  const a = info?.apuracao ?? null;
  const semRegistro = a?.semRegistro ?? detalhe.pessoa.semRegistro;
  return (
    <section className="rr-corpo" aria-labelledby="rr-p2">
      <h3 id="rr-p2">2. O que o sistema apurou</h3>
      {carregando && !a && <p className="rr-ajuda">Apurando salário, gorjeta, vales e VT…</p>}
      {!carregando && !a && <Alert tone="warning">Sem data de saída não há o que apurar: volte ao passo 1.</Alert>}
      {a && semRegistro && (
        <>
          <p className="rr-ajuda">Sem registro não passa pela contabilidade: tudo é pago na rescisão, com os descontos do mês. Os valores preenchem o passo 4.</p>
          <DestaqueSemRegistro a={a} />
          <ApuracaoRescisaoPainel apuracao={a} aberto />
        </>
      )}
      {a && !semRegistro && (
        <>
          <p className="rr-ajuda">CLT: o bruto (com a gorjeta) vem do termo da contabilidade. Aqui fica o que conferir nele e o VT a descontar.</p>
          <TermoCLT detalhe={detalhe} onMudou={onMudou} onLancarNormal={onLancarNormal} />
          <ApuracaoRescisaoPainel apuracao={a} aberto />
        </>
      )}
    </section>
  );
}
