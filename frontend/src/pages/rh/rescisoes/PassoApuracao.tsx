// Passo 2: o que o sistema apurou. Sem registro: salário, gorjeta, hora extra, vales,
// adiantamento/quinzena e VT, calculados aqui. CLT: o bruto vem do termo (TRCT) da
// contabilidade — importa-se o PDF e o sistema mostra o que ele trouxe.
import { useState } from "react";
import type { ApuracaoRescisao, DetalheRescisao, TerminationInfo } from "../../../api/client";
import { ApuracaoRescisaoPainel } from "../../../components/pessoal/ApuracaoRescisao";
import { useSession } from "../../../context/SessionContext";
import { Alert, Money } from "../../../design-system";
import { hasPermission } from "../../../lib/permissions";
import { ReciboRescisao } from "../../gorjeta/ReciboRescisao";
import "../../gorjeta/gorjeta.css";

const dataBr = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

type Props = { detalhe: DetalheRescisao; info: TerminationInfo | null; carregando: boolean; onMudou: () => void };

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

function TermoCLT({ detalhe, onMudou }: { detalhe: DetalheRescisao; onMudou: () => void }) {
  const { user } = useSession();
  const podeGorjeta = hasPermission(user, "payroll-tips", "edit");
  const [erro, setErro] = useState<string | null>(null);
  const termo = detalhe.pessoa.termo;
  const periodo = detalhe.periodoGorjeta;

  if (termo) {
    return (
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
    );
  }
  if (!periodo) {
    return <Alert tone="warning">Não há período de gorjeta com a data de saída: abra o período em Apuração de gorjeta para poder ler o termo.</Alert>;
  }
  return (
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
  );
}

export function PassoApuracao({ detalhe, info, carregando, onMudou }: Props) {
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
          <TermoCLT detalhe={detalhe} onMudou={onMudou} />
          <ApuracaoRescisaoPainel apuracao={a} aberto />
        </>
      )}
    </section>
  );
}
