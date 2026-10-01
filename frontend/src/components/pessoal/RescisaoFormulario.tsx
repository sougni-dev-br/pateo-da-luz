// Formulário da rescisão (passo 4 de RH → Rescisões): abre com o que o sistema apurou,
// deixa ajustar com justificativa e, depois de liberar, continua mostrando o que foi
// gravado. Era a janela aberta por Funcionários; a lógica é a mesma.
import { useEffect, useRef, useState } from "react";
import {
  type ApuracaoRescisao, type TerminationInfo,
  adjustTermination, getTerminationInfo, releaseTermination,
} from "../../api/client";
import { Alert, Button, FormField, FormGrid, Money, Select, Textarea, TextField } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { maskMoney, moneyToMasked } from "../../utils/format";
import { ApuracaoRescisaoPainel } from "./ApuracaoRescisao";
import { ListaDivergencias, RescisaoLancadaPainel } from "./RescisaoLancada";
import { type Campo, centavosDiferentes, dataBr, dicaValesRescisao, divergencias, quitacaoDoLiquido } from "./rescisaoFormato";
import { VerbasOpcionaisRescisao } from "./VerbasOpcionaisRescisao";
import {
  ESTADO_VERBAS_VAZIO, type EstadoVerbas, erroValorLivre, escolhaParaEnviar, estadoDasLancadas, mesmaEscolha, totalVerbasEscolhidas,
} from "./verbasOpcionais";
import "./rescisao.css";

const PARCELAS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: i === 0 ? "À vista (1×)" : `${i + 1}×` }));
const JUSTIFICATIVA_MINIMA = 10;

const FORM_VAZIO = () => ({
  grossAmount: "", salario: "", gorjeta: "", valesDiscount: "", valesLabel: "", vtDiscount: "",
  otherDiscount: "", otherDiscountLabel: "", dueDate: hojeLocalIso(), installments: "1", notes: "",
});
type Form = ReturnType<typeof FORM_VAZIO>;

const numero = (s: string) => {
  const t = s.trim();
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0;
};
const mascarar = (v: number | null | undefined) => (v == null ? "" : moneyToMasked(v));
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type Mensagem = { tom: "success" | "error"; texto: string } | null;

export type FuncionarioDaRescisao = { id: string; nome: string; semRegistro: boolean };
type Props = {
  funcionario: FuncionarioDaRescisao;
  onGravou: () => void;
  /** Mostra o quadro "Como o sistema chegou nesses valores" (recolhido). */
  mostrarApuracao?: boolean;
};

export function RescisaoFormulario({ funcionario, onGravou, mostrarApuracao = true }: Props) {
  const [info, setInfo] = useState<TerminationInfo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(FORM_VAZIO);
  const [busy, setBusy] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [just, setJust] = useState("");
  const [justErro, setJustErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<Mensagem>(null);
  // Verbas opcionais (sem registro): sempre desmarcadas ao abrir — decisão da empresa.
  const [verbas, setVerbas] = useState<EstadoVerbas>(ESTADO_VERBAS_VAZIO);
  const [livreErro, setLivreErro] = useState<string | null>(null);
  const justRef = useRef<HTMLDivElement>(null);
  const topoRef = useRef<HTMLDivElement>(null);

  const semRegistro = funcionario.semRegistro;
  const apuracao = info?.apuracao ?? null;
  const sugestao = apuracao?.sugestao ?? null;
  const lancada = info?.lancada ?? null;

  function aplicarApuracao(a: ApuracaoRescisao) {
    const s = a.sugestao;
    setForm((f) => ({
      ...f,
      salario: mascarar(s.salario), gorjeta: mascarar(s.gorjeta),
      valesDiscount: s.vales > 0 ? mascarar(s.vales) : "", valesLabel: s.valesRotulo ?? "",
      vtDiscount: mascarar(s.vtDesconto),
    }));
  }

  async function carregar() {
    setCarregando(true);
    setErroCarga(null);
    try {
      const i = await getTerminationInfo(funcionario.id);
      setInfo(i);
      // Já abre preenchido com o que o sistema apurou; quem lança confere e ajusta.
      if (i.apuracao && !i.alreadyReleased) aplicarApuracao(i.apuracao);
      if (!i.alreadyReleased) setVerbas(ESTADO_VERBAS_VAZIO);
    } catch (err) {
      setErroCarga(err instanceof Error ? err.message : "Não consegui carregar a apuração da rescisão.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => { void carregar(); }, [funcionario.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function avisar(m: Mensagem) {
    setMsg(m);
    requestAnimationFrame(() => topoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const creditos = semRegistro ? (sugestao?.creditos ?? 0) : 0;
  // Verbas marcadas somam no bruto mostrado; ao lançar, o servidor recalcula.
  const extras = semRegistro ? totalVerbasEscolhidas(apuracao?.verbasOpcionais?.calculo, verbas, numero) : { total: 0, oculto: false };
  const bruto = semRegistro ? Math.round((numero(form.salario) + numero(form.gorjeta) + creditos + extras.total) * 100) / 100 : numero(form.grossAmount);
  const valores: Record<Campo, number | null> = {
    salario: semRegistro ? numero(form.salario) : null,
    gorjeta: semRegistro ? numero(form.gorjeta) : null,
    vales: semRegistro ? numero(form.valesDiscount) : 0,
    vtDesconto: numero(form.vtDiscount),
  };
  const outro = numero(form.otherDiscount);
  const liquido = Math.round((bruto - (valores.vales ?? 0) - (valores.vtDesconto ?? 0) - outro) * 100) / 100;

  const editavel = !info?.alreadyReleased || ajustando;
  // Líquido zero ou negativo: lança como quitada (nada a pagar; o negativo é perdoado).
  const quitacao = !ajustando && !info?.alreadyReleased ? quitacaoDoLiquido(liquido) : null;
  const liquidoZerado = Math.round(liquido * 100) <= 0;
  const difs = ajustando ? [] : divergencias(sugestao, valores);
  const precisaJustificar = ajustando || difs.length > 0;
  const semSeparacao = ajustando && semRegistro && lancada?.salario == null;
  const nadaMudou = (() => {
    if (!ajustando || !lancada) return false;
    const txt = (v: string | null | undefined) => (v ?? "").trim();
    return !centavosDiferentes(lancada.bruto, bruto) && !centavosDiferentes(lancada.salario, valores.salario)
      && !centavosDiferentes(lancada.gorjeta, valores.gorjeta) && !centavosDiferentes(lancada.vales, valores.vales)
      && !centavosDiferentes(lancada.vtDesconto, valores.vtDesconto) && !centavosDiferentes(lancada.outroDesconto, outro)
      && txt(lancada.outroDescontoRotulo) === txt(form.otherDiscountLabel) && txt(lancada.valesRotulo) === txt(form.valesLabel)
      && txt(lancada.notes) === txt(form.notes)
      && mesmaEscolha(verbas, estadoDasLancadas(lancada.verbasOpcionais), numero);
  })();

  // Prévia do parcelamento — mesma conta de centavos do backend (a 1ª absorve o resto).
  const nParcelas = Math.max(1, Math.min(Number(form.installments) || 1, 12));
  const parcelas = (() => {
    if (ajustando || liquido <= 0 || nParcelas <= 1) return [] as Array<{ n: number; valor: number; vence: Date }>;
    const total = Math.round(liquido * 100);
    const base = Math.floor(total / nParcelas);
    const [a, m, d] = (form.dueDate || hojeLocalIso()).split("-").map(Number);
    return Array.from({ length: nParcelas }, (_, i) => {
      const vence = new Date(a, (m ?? 1) - 1 + i, 1);
      vence.setDate(Math.min(d ?? 1, new Date(vence.getFullYear(), vence.getMonth() + 1, 0).getDate()));
      return { n: i + 1, valor: (base + (i === 0 ? total - base * nParcelas : 0)) / 100, vence };
    });
  })();

  // Valor livre marcado sem valor ou sem descrição: mostra o erro no campo e não envia.
  function verbasValidas(): boolean {
    const erro = semRegistro ? erroValorLivre(verbas, numero) : null;
    setLivreErro(erro);
    return erro == null;
  }

  // Justificativa curta: em vez de botão cinza sem explicação, mostra o que falta no campo.
  function justificativaValida(): boolean {
    if (!precisaJustificar) return true;
    const faltam = JUSTIFICATIVA_MINIMA - just.trim().length;
    if (faltam <= 0) return true;
    setJustErro(`Explique o ajuste em pelo menos ${JUSTIFICATIVA_MINIMA} letras (faltam ${faltam}).`);
    justRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    justRef.current?.querySelector("textarea")?.focus({ preventScroll: true });
    return false;
  }

  const partes = () => ({
    grossAmount: bruto,
    ...(semRegistro ? {
      salario: valores.salario ?? 0, gorjeta: valores.gorjeta ?? 0, valesDiscount: valores.vales ?? 0, valesLabel: form.valesLabel,
      verbasOpcionais: escolhaParaEnviar(verbas, numero),
    } : {}),
    vtDiscount: valores.vtDesconto ?? 0,
    otherDiscount: outro,
    otherDiscountLabel: form.otherDiscountLabel,
  });

  async function liberar() {
    setMsg(null);
    const descontos = (valores.vales ?? 0) + (valores.vtDesconto ?? 0) + outro;
    if (bruto <= 0 && descontos <= 0) {
      return avisar({ tom: "error", texto: semRegistro ? "Informe o salário e a gorjeta da rescisão." : "Informe o valor bruto que a contabilidade enviou." });
    }
    if (!verbasValidas()) return;
    if (!justificativaValida()) return;
    setBusy(true);
    try {
      const r = await releaseTermination(funcionario.id, {
        ...partes(), dueDate: form.dueDate || undefined, installments: quitacao ? 1 : nParcelas, notes: form.notes || undefined,
        ajusteJustificativa: difs.length > 0 ? just.trim() : undefined,
      });
      await carregar();
      setJust("");
      onGravou();
      const perdoado = r.saldoDevedorPerdoado ?? 0;
      avisar({
        tom: "success",
        texto: r.quitadaSemValor
          ? `Rescisão lançada como quitada: ${perdoado > 0 ? `saldo devedor de ${reais(perdoado)} perdoado, ` : ""}nada a pagar.`
          : `Rescisão liberada para Contas a Pagar: líquido ${reais(r.amount)}${r.installments > 1 ? ` em ${r.installments} parcelas` : ""}.`,
      });
    } catch (err) {
      avisar({ tom: "error", texto: err instanceof Error ? err.message : "Não consegui liberar a rescisão." });
    } finally {
      setBusy(false);
    }
  }

  function iniciarAjuste() {
    if (!lancada) return;
    // Lançada antes da separação salário/gorjeta: parte do apurado para os dois.
    setForm((f) => ({
      ...f,
      grossAmount: mascarar(lancada.bruto),
      salario: mascarar(lancada.salario ?? sugestao?.salario), gorjeta: mascarar(lancada.gorjeta ?? sugestao?.gorjeta),
      valesDiscount: lancada.vales > 0 ? mascarar(lancada.vales) : "", valesLabel: lancada.valesRotulo ?? "",
      vtDiscount: mascarar(lancada.vtDesconto),
      otherDiscount: lancada.outroDesconto > 0 ? mascarar(lancada.outroDesconto) : "", otherDiscountLabel: lancada.outroDescontoRotulo ?? "",
      notes: lancada.notes ?? "",
    }));
    setVerbas(estadoDasLancadas(lancada.verbasOpcionais));
    setLivreErro(null);
    setJust("");
    setJustErro(null);
    setMsg(null);
    setAjustando(true);
  }

  async function salvarAjuste() {
    setMsg(null);
    if (!verbasValidas()) return;
    if (!justificativaValida()) return;
    const antes = lancada?.liquido ?? 0;
    setBusy(true);
    try {
      const r = await adjustTermination(funcionario.id, { ...partes(), notes: form.notes, justificativa: just.trim() });
      setInfo((i) => (i ? { ...i, lancada: r.lancada } : i));
      setAjustando(false);
      setJust("");
      onGravou();
      avisar({ tom: "success", texto: `Ajuste salvo: líquido ${reais(antes)} → ${reais(r.lancada.liquido)}. O valor anterior e a justificativa ficaram no histórico.` });
    } catch (err) {
      avisar({ tom: "error", texto: err instanceof Error ? err.message : "Não consegui salvar o ajuste." });
    } finally {
      setBusy(false);
    }
  }

  // Embaixo do campo, só quando o digitado difere do apurado: "apurado: R$ X · voltar ao apurado".
  function Apurado({ campo, valor, semApurado }: { campo: Campo; valor: number | null | undefined; semApurado?: string }) {
    if (!editavel) return null;
    if (valor == null) return semApurado ? <div className="resc-apurado">{semApurado}</div> : null;
    const diferente = centavosDiferentes(valores[campo], valor);
    if (!diferente) return null;
    const chave: Record<Campo, keyof Form> = { salario: "salario", gorjeta: "gorjeta", vales: "valesDiscount", vtDesconto: "vtDiscount" };
    return (
      <div className={`resc-apurado${diferente ? " resc-apurado--diferente" : ""}`}>
        <span>apurado: <Money value={valor} /></span>
        {diferente && (
          <button type="button" className="resc-link" onClick={() => setForm((f) => ({ ...f, [chave[campo]]: mascarar(valor) }))}>
            voltar ao apurado
          </button>
        )}
      </div>
    );
  }

  const campoDinheiro = (chave: keyof Form, rotulo: string, extra?: { obrigatorio?: boolean; dica?: string }) => (
    <FormField label={rotulo} required={extra?.obrigatorio} hint={extra?.dica}>
      <TextField value={form[chave]} onChange={(e) => setForm({ ...form, [chave]: maskMoney(e.target.value) })} placeholder="0,00" inputMode="numeric" aria-label={rotulo} />
    </FormField>
  );

  return (
    <div className="resc-form">
        <div ref={topoRef} className="resc-form-topo" />
        {msg && <div style={{ marginBottom: 12 }}><Alert tone={msg.tom}>{msg.texto}</Alert></div>}

        {carregando && <p className="resc-detalhe">Apurando salário, gorjeta, vales e VT…</p>}

        {!carregando && erroCarga && (
          <div className="resc-quadro resc-quadro--aviso">
            <Alert tone="error">{erroCarga}</Alert>
            <div style={{ marginTop: 8 }}><Button size="sm" variant="secondary" onClick={() => void carregar()}>Tentar de novo</Button></div>
          </div>
        )}

        {!carregando && !erroCarga && info && (
          <>
            {lancada && <RescisaoLancadaPainel lancada={lancada} ajustando={ajustando} onAjustar={iniciarAjuste} />}

            {apuracao && mostrarApuracao && <ApuracaoRescisaoPainel apuracao={apuracao} />}

            {!apuracao && !info.alreadyReleased && (
              <div className="resc-quadro">
                {info.vtItems.length > 0
                  ? <div style={{ fontSize: 13 }}>VT já pago no mês do desligamento (veja se cabe estorno): {info.vtItems.map((v) => `${v.periodLabel} (${reais(Number(v.amount))})`).join(" · ")}</div>
                  : <div className="resc-detalhe">Sem data de desligamento: não há o que apurar.</div>}
              </div>
            )}

            {editavel && (
              <>
                {ajustando && <div style={{ marginBottom: 12 }}><Alert tone="info">Ajustando a rescisão lançada: o líquido novo se reparte nas mesmas parcelas, com os mesmos vencimentos.</Alert></div>}
                {ajustando && liquidoZerado && (
                  <div style={{ marginBottom: 12 }}>
                    <Alert tone="warning">Com esse ajuste o líquido fica zero ou negativo: o ajuste não quita a rescisão. Exclua a rescisão e lance de novo, que ela fica quitada.</Alert>
                  </div>
                )}
                {semSeparacao && (
                  <div style={{ marginBottom: 12 }}>
                    <Alert tone="warning">Lançada antes da separação entre salário e gorjeta (bruto lançado: <Money value={lancada?.bruto ?? 0} />). Salário e gorjeta vieram do apurado: confira antes de salvar.</Alert>
                  </div>
                )}
                <FormGrid cols={2}>
                  {semRegistro ? (
                    <>
                      <div>{campoDinheiro("salario", "Salário proporcional", { obrigatorio: true })}<Apurado campo="salario" valor={sugestao?.salario} /></div>
                      <div>{campoDinheiro("gorjeta", "Gorjeta até a saída", { obrigatorio: true })}<Apurado campo="gorjeta" valor={sugestao?.gorjeta} semApurado={apuracao?.gorjetaObservacao ?? "sem valor apurado: digite a gorjeta paga"} /></div>
                      <div>{campoDinheiro("valesDiscount", "Vales a descontar", { dica: dicaValesRescisao(sugestao) })}<Apurado campo="vales" valor={sugestao?.vales} /></div>
                      <FormField label="Quais vales (códigos)">
                        <TextField value={form.valesLabel} onChange={(e) => setForm({ ...form, valesLabel: e.target.value })} placeholder="Ex.: VALE-2026-00012" />
                      </FormField>
                    </>
                  ) : (
                    campoDinheiro("grossAmount", "Valor bruto (contabilidade)", { obrigatorio: true, dica: "a gorjeta já vem no TRCT" })
                  )}
                  <div>{campoDinheiro("vtDiscount", "VT a descontar", { dica: "VT já pago para os dias depois da saída" })}<Apurado campo="vtDesconto" valor={sugestao?.vtDesconto} /></div>
                  {campoDinheiro("otherDiscount", "Outro desconto (opcional)")}
                  <FormField label="Descrição do outro desconto">
                    <TextField value={form.otherDiscountLabel} onChange={(e) => setForm({ ...form, otherDiscountLabel: e.target.value })} placeholder="Ex.: adiantamento em aberto" />
                  </FormField>
                  {/* Quitada: não há título a pagar — sem vencimento nem parcelas (paga na saída). */}
                  {!ajustando && !quitacao && (
                    <>
                      <FormField label={nParcelas > 1 ? "Vencimento da 1ª parcela" : "Vencimento"}>
                        <TextField type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
                      </FormField>
                      <FormField label="Parcelas" hint="acordo (art. 484-A) pode ser dividido em meses">
                        <Select value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} options={PARCELAS} />
                      </FormField>
                    </>
                  )}
                  <div className="ds-form-grid-span-all">
                    <FormField label="Observações">
                      <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                    </FormField>
                  </div>
                </FormGrid>

                {semRegistro && (
                  <VerbasOpcionaisRescisao verbas={apuracao?.verbasOpcionais} estado={verbas} erroLivre={livreErro}
                    onChange={(e) => { setVerbas(e); setLivreErro(null); }} />
                )}

                {quitacao && (
                  <div style={{ marginTop: 12 }}>
                    <Alert tone="info">{quitacao.mensagem}</Alert>
                  </div>
                )}

                {parcelas.length > 0 && (
                  <div className="resc-quadro" style={{ marginTop: 12 }}>
                    <div className="resc-detalhe">{parcelas.length} parcelas mensais · viram {parcelas.length} títulos em Contas a Pagar</div>
                    {parcelas.map((p) => (
                      <div key={p.n} className="resc-parcela">
                        <span>Parcela {p.n}/{parcelas.length} · vence {dataBr(p.vence.toISOString())}</span>
                        <strong><Money value={p.valor} /></strong>
                      </div>
                    ))}
                  </div>
                )}

                {precisaJustificar && (
                  <div className="resc-quadro resc-quadro--aviso" ref={justRef} style={{ marginTop: 12 }}>
                    <strong style={{ fontSize: 14 }}>{ajustando ? "Por que ajustar a rescisão lançada?" : "Você mudou o que o sistema apurou"}</strong>
                    {difs.length > 0 && <ListaDivergencias itens={difs} rotuloLancado="no formulário" />}
                    <FormField label="Justificativa (obrigatória)" error={justErro ?? undefined} hint="fica gravada na rescisão, com o apurado e o lançado">
                      <Textarea rows={2} value={just} onChange={(e) => { setJust(e.target.value); setJustErro(null); }}
                        placeholder="Ex.: gorjeta de 26 a 31/08 paga em 04/09 com o salário" />
                    </FormField>
                    {nadaMudou && <div className="resc-detalhe" style={{ marginTop: 4 }}>Nada mudou em relação à rescisão lançada: altere algum valor para salvar.</div>}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {(editavel || ajustando) && !carregando && !erroCarga && info && (
        <div className="resc-rodape">
          {editavel ? (
            <div className="resc-rodape-valor">
              <span className="resc-detalhe">
                {quitacao ? "Nada a pagar · quitada" : "Líquido a pagar"}{precisaJustificar && !ajustando ? " · precisa justificar" : ""}
              </span>
              <strong><Money value={quitacao ? 0 : liquido} /></strong>
              <span className="resc-detalhe">
                bruto <Money value={bruto} />{creditos > 0 && <> (com <Money value={creditos} /> de créditos{(sugestao?.horaExtra ?? 0) > 0 && " e hora extra"})</>}
                {extras.total > 0 && <> (com <Money value={extras.total} /> de verbas opcionais)</>}
                {extras.oculto && <> (+ verbas com valor oculto, calculadas ao lançar)</>}
                {(valores.vales ?? 0) > 0 && <> − vales <Money value={valores.vales} /></>}
                {(valores.vtDesconto ?? 0) > 0 && <> − VT <Money value={valores.vtDesconto} /></>}
                {outro > 0 && <> − outro <Money value={outro} /></>}
              </span>
            </div>
          ) : <span />}
          <div className="resc-rodape-acoes">
            {ajustando ? (
              <>
                <Button variant="secondary" onClick={() => { setAjustando(false); setJustErro(null); }} disabled={busy}>Desistir do ajuste</Button>
                <Button onClick={() => void salvarAjuste()} disabled={busy || nadaMudou || liquidoZerado}>{busy ? "Salvando…" : "Salvar ajuste"}</Button>
              </>
            ) : !info.alreadyReleased ? (
              <Button onClick={() => void liberar()} disabled={busy || carregando}>
                {busy ? "Lançando…" : quitacao ? "Lançar como quitada" : "Liberar para Contas a Pagar"}
              </Button>
            ) : null}
          </div>
        </div>
        )}
    </div>
  );
}
