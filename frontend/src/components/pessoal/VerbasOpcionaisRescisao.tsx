// "Verbas opcionais (decisão da empresa)": férias + 1/3, 13º, aviso prévio e valor livre
// na rescisão de sem registro. Desmarcadas ao abrir; nada entra sem alguém marcar.
// Sem onChange = só leitura (passo 2): mostra o cálculo com as caixas travadas.
import type { ReactNode } from "react";
import type { VerbasOpcionaisApuracao } from "../../api/client";
import { Alert, FormField, Money, TextField } from "../../design-system";
import { maskMoney } from "../../utils/format";
import type { EstadoVerbas } from "./verbasOpcionais";
import "./rescisao.css";

type Props = {
  verbas: VerbasOpcionaisApuracao | null | undefined;
  estado: EstadoVerbas;
  onChange?: (e: EstadoVerbas) => void;
  erroLivre?: string | null;
};

type Chave = "ferias" | "decimoTerceiro" | "aviso";

function Opcao({ id, rotulo, marcada, travada, onToggle, valor, detalhe }: {
  id: string; rotulo: string; marcada: boolean; travada: boolean; onToggle: () => void; valor?: ReactNode; detalhe?: ReactNode;
}) {
  return (
    <div className={`resc-verba${marcada ? " resc-verba--marcada" : ""}`}>
      <label className="resc-verba-rotulo" htmlFor={id}>
        <input id={id} type="checkbox" checked={marcada} disabled={travada} onChange={onToggle} aria-describedby={detalhe ? `${id}-det` : undefined} />
        <span>{rotulo}</span>
      </label>
      {valor !== undefined && <strong className="resc-verba-valor">{valor}</strong>}
      {detalhe && <div id={`${id}-det`} className="resc-detalhe resc-verba-detalhe">{detalhe}</div>}
    </div>
  );
}

const valorOuOculto = (v: number | null | undefined) => (v == null ? <span className="resc-detalhe">valor oculto</span> : <Money value={v} />);

export function VerbasOpcionaisRescisao({ verbas, estado, onChange, erroLivre }: Props) {
  const somenteLeitura = !onChange;
  const c = verbas?.calculo ?? null;
  const alternar = (k: Chave | "livre") => onChange?.({ ...estado, [k]: !estado[k] });
  // Valor oculto = sem permissão de ver Funcionários: o servidor recusa férias, 13º e aviso.
  // A caixa fica travada para marcar (desmarcar uma já lançada continua possível).
  const semPermissao = c != null && [c.ferias.valor, c.decimoTerceiro.valor, c.aviso.valor].some((v) => v == null);
  const calculada = (k: Chave, rotulo: string, valor: number | null | undefined, detalhe: ReactNode) => (
    <Opcao id={`verba-${k}`} rotulo={rotulo} marcada={estado[k]}
      travada={somenteLeitura || !c || (valor == null && !estado[k])} onToggle={() => alternar(k)}
      valor={c ? valorOuOculto(valor) : undefined} detalhe={detalhe} />
  );

  return (
    <fieldset className="resc-verbas">
      <legend>Verbas opcionais (decisão da empresa)</legend>
      <p className="resc-detalhe" style={{ margin: "0 0 6px" }}>
        Sem registro não tem termo da contabilidade: férias, 13º e aviso só entram se a empresa decidir pagar.
        {somenteLeitura ? " Para incluir, marque no passo 4." : " Marcar soma no bruto e no líquido; o valor é recalculado ao lançar."}
      </p>
      {verbas?.observacao && <div className="resc-detalhe" style={{ marginBottom: 6 }}>{verbas.observacao}</div>}
      {c?.avisoFeriasVencidas && <div style={{ marginBottom: 8 }}><Alert tone="warning">{c.avisoFeriasVencidas}</Alert></div>}
      {semPermissao && !somenteLeitura && (
        <div style={{ marginBottom: 8 }}>
          <Alert tone="info">Sem permissão de ver Funcionários: férias, 13º e aviso não podem ser incluídos por você (o valor é calculado do salário). Só o valor livre fica disponível.</Alert>
        </div>
      )}

      {calculada("ferias", "Férias proporcionais + 1/3", c?.ferias.valor,
        c ? <>{c.ferias.avos} {c.ferias.avos === 1 ? "avo" : "avos"} desde {c.ferias.inicioAquisitivo.split("-").reverse().join("/")} · {c.ferias.memoria}</> : null)}
      {calculada("decimoTerceiro", "13º proporcional", c?.decimoTerceiro.valor,
        c ? <>{c.decimoTerceiro.avos} {c.decimoTerceiro.avos === 1 ? "avo" : "avos"} em {c.decimoTerceiro.desde.slice(0, 4)} · {c.decimoTerceiro.memoria}</> : null)}
      {calculada("aviso", "Aviso prévio indenizado", c?.aviso.valor,
        c ? <>{c.aviso.dias} dias (30 + 3 por ano completo, até 90; {c.aviso.anos} {c.aviso.anos === 1 ? "ano" : "anos"}) · {c.aviso.memoria}</> : null)}
      <Opcao id="verba-livre" rotulo="Valor livre (acordo, gratificação)" marcada={estado.livre} travada={somenteLeitura}
        onToggle={() => alternar("livre")} detalhe="valor digitado, com descrição obrigatória" />
      {estado.livre && !somenteLeitura && (
        <div className="resc-verba-livre">
          <FormField label="Valor livre (R$)" required>
            <TextField value={estado.livreValor} placeholder="0,00" inputMode="numeric" aria-label="Valor livre (R$)"
              onChange={(e) => onChange?.({ ...estado, livreValor: maskMoney(e.target.value) })} />
          </FormField>
          <FormField label="Descrição do valor livre" required error={erroLivre ?? undefined}>
            <TextField value={estado.livreDescricao} placeholder="Ex.: acordo de saída" aria-label="Descrição do valor livre"
              onChange={(e) => onChange?.({ ...estado, livreDescricao: e.target.value })} />
          </FormField>
        </div>
      )}
      <p className="resc-detalhe" style={{ margin: "8px 0 0" }}>
        Aviso sem projeção: os dias do aviso não somam avos de férias nem de 13º. Base: salário base vigente na saída.
      </p>
    </fieldset>
  );
}
