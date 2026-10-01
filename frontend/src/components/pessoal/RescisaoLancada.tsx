// A rescisão já lançada: o líquido, a composição, as parcelas e o que foi ajustado à
// mão (com o porquê). Valores sempre por <Money>, que respeita o "ocultar valores".
import { Fragment } from "react";
import type { RescisaoLancada as Lancada, ValoresRescisaoLancada } from "../../api/client";
import { Button, Money, StatusBadge } from "../../design-system";
import { centavosDiferentes, dataBr, type Divergencia } from "./rescisaoFormato";
import "./rescisao.css";

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function ListaDivergencias({ itens, rotuloLancado = "lançado" }: { itens: Array<Omit<Divergencia, "campo">>; rotuloLancado?: string }) {
  return (
    <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 13 }}>
      {itens.map((d) => (
        <li key={d.rotulo}>
          {d.rotulo}: apurado <Money value={d.apurado} /> → {rotuloLancado} <strong><Money value={d.lancado} /></strong>{" "}
          <span className="resc-detalhe">({d.diferenca > 0 ? "+" : "−"}<Money value={Math.abs(d.diferenca)} />)</span>
        </li>
      ))}
    </ul>
  );
}

// "gorjeta R$ 516,29 → R$ 400,00 · vales R$ 0,00 → R$ 50,00" — só o que mudou.
function Mudancas({ antes, depois }: { antes: ValoresRescisaoLancada; depois: ValoresRescisaoLancada }) {
  const campos: Array<[string, number | null, number | null]> = [
    ["salário", antes.salario, depois.salario], ["gorjeta", antes.gorjeta, depois.gorjeta],
    ["bruto", antes.bruto, depois.bruto], ["vales", antes.vales, depois.vales],
    ["VT", antes.vtDesconto, depois.vtDesconto], ["outro desconto", antes.outroDesconto, depois.outroDesconto],
  ];
  const mudou = campos.filter(([, a, d]) => centavosDiferentes(a, d));
  if (mudou.length === 0) return <>só descrição ou observação</>;
  return (
    <>
      {mudou.map(([r, a, d], i) => (
        <Fragment key={r}>
          {i > 0 && " · "}
          {r} {a == null ? "—" : <Money value={a} />} → {d == null ? "—" : <Money value={d} />}
        </Fragment>
      ))}
    </>
  );
}

function Parte({ rotulo, valor, desconto }: { rotulo: string; valor: number | null; desconto?: boolean }) {
  if (valor == null || (desconto && valor === 0)) return null;
  return (
    <div className="resc-linha">
      <span>{rotulo}</span>
      <strong>{desconto ? "− " : ""}<Money value={valor} /></strong>
    </div>
  );
}

export function RescisaoLancadaPainel({ lancada: l, ajustando, onAjustar }: { lancada: Lancada; ajustando: boolean; onAjustar: () => void }) {
  return (
    <div className="resc-quadro">
      <div className="resc-quadro-topo">
        <span className="resc-detalhe" style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>Rescisão lançada</span>
        {ajustando
          ? <StatusBadge tone="info">em ajuste</StatusBadge>
          : l.quitadaSemValor
            ? <StatusBadge tone="success">quitada: nada a pagar</StatusBadge>
          : l.algumaPaga
            ? <StatusBadge tone="warning">parcela paga: para ajustar, estorne em Contas a Pagar</StatusBadge>
            : <Button size="sm" variant="secondary" onClick={onAjustar}>Ajustar rescisão</Button>}
      </div>

      <div className="resc-destaque">
        <span>Líquido</span>
        <strong><Money value={l.liquido} /></strong>
      </div>
      <Parte rotulo="Salário proporcional" valor={l.salario} />
      <Parte rotulo="Gorjeta" valor={l.gorjeta} />
      <Parte rotulo="Bruto" valor={l.bruto} />
      <Parte rotulo={l.valesRotulo ? `Vales (${l.valesRotulo})` : "Vales"} valor={l.vales} desconto />
      <Parte rotulo="VT" valor={l.vtDesconto} desconto />
      <Parte rotulo={l.outroDescontoRotulo ? `Outro desconto (${l.outroDescontoRotulo})` : "Outro desconto"} valor={l.outroDesconto} desconto />
      {(l.quitadaSemValor?.saldoDevedorPerdoado ?? 0) > 0 && (
        <Parte rotulo="Saldo devedor perdoado (os descontos passaram do bruto)" valor={l.quitadaSemValor!.saldoDevedorPerdoado} />
      )}

      <div style={{ marginTop: 8 }}>
        {l.parcelas.map((p) => (
          <div key={p.id} className="resc-parcela">
            <span>{p.rotulo} · vence {dataBr(p.vencimento)}</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong><Money value={p.valor} /></strong>
              <StatusBadge tone={p.paga ? "success" : "neutral"}>{p.paga ? "paga" : "a pagar"}</StatusBadge>
            </span>
          </div>
        ))}
      </div>

      {l.ajusteManual && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <strong>Lançada com ajuste sobre o apurado</strong>
          <span className="resc-detalhe"> · {l.ajusteManual.porNome ?? "—"}, {dataHora(l.ajusteManual.em)}</span>
          <ListaDivergencias itens={l.ajusteManual.divergencias} />
          <div style={{ marginTop: 2 }}>Justificativa: “{l.ajusteManual.justificativa}”</div>
        </div>
      )}

      {l.historicoAjustes.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <strong>Ajustes depois de lançada</strong>
          {[...l.historicoAjustes].reverse().map((a, i) => (
            <div key={i} className="resc-historico">
              <div className="resc-detalhe">{a.porNome ?? "—"} · {dataHora(a.em)}</div>
              <div>
                Líquido <Money value={a.antes.liquido} /> → <strong><Money value={a.depois.liquido} /></strong>
                <span className="resc-detalhe"> (<Mudancas antes={a.antes} depois={a.depois} />)</span>
              </div>
              <div>Justificativa: “{a.justificativa}”</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
