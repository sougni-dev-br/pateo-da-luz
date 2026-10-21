import { CheckCircle2, CircleAlert, Lock, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { TaxCode } from "../../api/client";
import { Button, IconButton, Money } from "../../design-system";
import { maskMoney } from "../../utils/format";
import { descricaoDoCodigo, estadoDaDenominacao, novaLinha, totalDaGuia, totalDaLinha, valorColado, type LinhaForm } from "./formularioGuia";
import "./tax-payments.css";

type Props = {
  linhas: LinhaForm[];
  tipo: string;
  /** Códigos conhecidos do tipo de guia: o código digitado traz a denominação (travada). */
  catalogo: TaxCode[];
  onChange: (linhas: LinhaForm[]) => void;
  /** Guia já paga: os valores não mudam aqui (estornar em Contas a Pagar primeiro). */
  somenteLeitura: boolean;
  /** Multa e juros quase nunca existem: ficam recolhidos até a pessoa pedir (ou a guia já ter esses valores). */
  mostrarMultaJuros: boolean;
  /** Total impresso no documento, para conferir com a soma. */
  totalDoPapel: string;
  onTotalDoPapel: (texto: string) => void;
  /** Soma das linhas menos o total do papel (null = total do papel não informado). */
  diferenca: number | null;
  /** Chaves das linhas com pendência (destacadas). */
  linhasPendentes?: string[];
};

type Campo = "code" | "description" | "principal" | "fine" | "interest";

const ROTULO: Record<"principal" | "fine" | "interest", string> = { principal: "Principal", fine: "Multa", interest: "Juros" };

// A composição da guia como no documento oficial: uma linha por código. A pessoa digita o código e a denominação vem
// dele, travada (o sistema guarda os códigos); código novo pede a denominação uma vez e fica guardado.
// Enter pula para o principal; na última linha, abre uma linha nova.
export function LinhasDaGuia({
  linhas, tipo, catalogo, onChange, somenteLeitura, mostrarMultaJuros, totalDoPapel, onTotalDoPapel, diferenca, linhasPendentes = [],
}: Props) {
  const listaId = useId();
  const principais = useRef(new Map<string, HTMLInputElement>());
  const [focarLinha, setFocarLinha] = useState<string | null>(null);

  // Linha recém-criada pelo Enter: o foco vai para ela depois de desenhada.
  useEffect(() => {
    if (!focarLinha) return;
    principais.current.get(focarLinha)?.focus();
    setFocarLinha(null);
  }, [focarLinha, linhas]);

  function mudar(chave: string, campo: Campo, valor: string) {
    onChange(linhas.map((l) => {
      if (l.chave !== chave) return l;
      const proxima = { ...l, [campo]: valor };
      if (campo === "code") {
        // Código digitado: a denominação vem do catálogo. Se o código deixou de existir, a anterior (que era do catálogo
        // ou do modelo) não vale mais e sai.
        const estavaTravada = estadoDaDenominacao(l, tipo, catalogo) === "travada";
        const doCatalogo = descricaoDoCodigo(catalogo, valor);
        proxima.doModelo = false;
        if (doCatalogo) proxima.description = doCatalogo;
        else if (estavaTravada) proxima.description = "";
      }
      return proxima;
    }));
  }

  function teclar(e: KeyboardEvent<HTMLInputElement>, indice: number, daLinha: boolean) {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    // Enter nunca grava a guia: só anda. No código e na denominação vai para o valor da própria linha.
    e.preventDefault();
    if (daLinha) { principais.current.get(linhas[indice].chave)?.focus(); return; }
    const proxima = linhas[indice + 1];
    if (proxima) { principais.current.get(proxima.chave)?.focus(); return; }
    if (somenteLeitura) return;
    const nova = novaLinha();
    onChange([...linhas, nova]);
    setFocarLinha(nova.chave);
  }

  function colar(e: ClipboardEvent<HTMLInputElement>, chave: string, campo: "principal" | "fine" | "interest") {
    const texto = e.clipboardData.getData("text");
    if (!texto) return;
    e.preventDefault();
    mudar(chave, campo, valorColado(texto));
  }

  const campos = mostrarMultaJuros ? (["principal", "fine", "interest"] as const) : (["principal"] as const);

  return (
    <div className={`ip-linhas${mostrarMultaJuros ? "" : " ip-linhas--simples"}`} role="group" aria-label="Composição da guia">
      <div className="ip-linhas-cab" aria-hidden="true">
        <span>Código</span><span>Denominação</span>
        {campos.map((c) => <span key={c}>{ROTULO[c]}</span>)}
        <span>Total</span><span />
      </div>

      {linhas.map((l, i) => {
        const pendente = linhasPendentes.includes(l.chave);
        const n = i + 1;
        const total = totalDaLinha(l);
        const estado = estadoDaDenominacao(l, tipo, catalogo);
        const travada = somenteLeitura || estado !== "livre";
        const codigoNovo = estado === "livre" && l.code.trim() !== "";
        return (
          <div className={`ip-linha-form${total > 0 ? " ip-linha-form--cheia" : ""}`} key={l.chave}>
            <input
              className="ds-text-field-input ip-in-codigo" data-linha={l.chave} aria-label={`Código da linha ${n}`} placeholder="Cód." inputMode="numeric" list={listaId}
              tabIndex={l.doModelo ? -1 : undefined} value={l.code} disabled={somenteLeitura}
              onChange={(e) => mudar(l.chave, "code", e.target.value)} onKeyDown={(e) => teclar(e, i, true)}
            />
            {/* A denominação não se digita quando o código a traz: campo travado, que o código preenche. */}
            <div className={`ip-nome${travada ? " ip-nome--travada" : ""}`}>
              <input
                className="ds-text-field-input ip-in-nome" data-linha-nome={l.chave} aria-label={`Denominação da linha ${n}`} readOnly={travada} tabIndex={travada ? -1 : undefined}
                placeholder={estado === "aguardaCodigo" ? "Digite o código ao lado" : codigoNovo ? "Código novo: informe a denominação" : "Denominação"}
                aria-invalid={pendente || undefined} value={l.description} disabled={somenteLeitura && !l.description}
                onChange={(e) => mudar(l.chave, "description", e.target.value)} onKeyDown={(e) => teclar(e, i, true)}
              />
              {travada && l.description && !somenteLeitura && <Lock size={12} className="ip-nome-cadeado" aria-hidden="true" />}
            </div>
            {campos.map((campo) => (
              // No celular o cabeçalho some e cada valor ganha o seu rótulo.
              <label key={campo} className="ip-cel">
                <span className="ip-cel-rotulo" aria-hidden="true">{ROTULO[campo]}</span>
                <input
                  ref={campo === "principal" ? (el) => { if (el) principais.current.set(l.chave, el); else principais.current.delete(l.chave); } : undefined}
                  className="ds-text-field-input ip-in-valor" inputMode="decimal" placeholder="0,00" aria-label={`${ROTULO[campo]} da linha ${n}`}
                  value={l[campo]} disabled={somenteLeitura}
                  onChange={(e) => mudar(l.chave, campo, maskMoney(e.target.value))}
                  onPaste={(e) => colar(e, l.chave, campo)}
                  onKeyDown={(e) => teclar(e, i, false)}
                />
              </label>
            ))}
            <div className="ip-cel">
              <span className="ip-cel-rotulo" aria-hidden="true">Total</span>
              <output className="ip-linha-total" aria-label={`Total da linha ${n}`}>
                {total > 0 ? <Money value={total} /> : <span aria-hidden="true">—</span>}
              </output>
            </div>
            {somenteLeitura ? <span /> : (
              <IconButton
                label={`Remover a linha ${n}`} icon={<X size={15} />} size="sm" tabIndex={-1}
                onClick={() => onChange(linhas.length > 1 ? linhas.filter((x) => x.chave !== l.chave) : [novaLinha()])}
              />
            )}
            {codigoNovo && !somenteLeitura && <small className="ip-dica-linha">Código novo para {tipo || "este tipo de guia"}: a denominação fica guardada no sistema para as próximas guias.</small>}
          </div>
        );
      })}

      <datalist id={listaId}>
        {catalogo.map((c) => <option key={c.code} value={c.code}>{c.description}</option>)}
      </datalist>

      {!somenteLeitura && <small className="ip-dica-linhas">Digite o código: a denominação vem sozinha. Linhas sem valor são ignoradas ao salvar. Enter passa para o valor.</small>}

      <div className="ip-linhas-rodape">
        {somenteLeitura ? <span /> : (
          <Button size="sm" variant="secondary" leadingIcon={<Plus size={14} />} onClick={() => onChange([...linhas, novaLinha()])}>Adicionar linha</Button>
        )}
        <div className="ip-totais">
          <div className="ip-total-guia" aria-live="polite">
            <span className="ip-rotulo">Total da guia</span>
            <strong><Money value={totalDaGuia(linhas)} /></strong>
          </div>
          {!somenteLeitura && (
            <div className="ip-total-papel">
              <label>
                <span className="ip-rotulo">Total no papel (conferir)</span>
                <input
                  className="ds-text-field-input ip-in-valor" inputMode="decimal" placeholder="0,00" aria-label="Total impresso no documento, para conferir"
                  value={totalDoPapel} onChange={(e) => onTotalDoPapel(maskMoney(e.target.value))}
                  onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); onTotalDoPapel(valorColado(t)); } }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) e.preventDefault(); }}
                />
              </label>
              {diferenca != null && (
                diferenca === 0
                  ? <span className="ip-confere ip-confere--ok" role="status"><CheckCircle2 size={14} aria-hidden="true" /> Confere com o papel</span>
                  : <span className="ip-confere ip-confere--erro" role="status"><CircleAlert size={14} aria-hidden="true" /> Diferença de <Money value={Math.abs(diferenca)} /></span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
