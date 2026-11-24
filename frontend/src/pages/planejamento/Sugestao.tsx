import type { ReactNode } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Alert, Button } from "../../design-system";

// Uma linha de sugestão dos diálogos "Preencher com o realizado": marcar, o que é, e a diferença que interessa na
// decisão (hoje no cenário → realizado). Linha sem mudança fica cinza, escrita "igual ao cenário". É uma lista, não
// uma tabela: no computador as colunas se alinham; no celular cada linha vira um cartão, sem rolagem lateral.

type Props = {
  nome: ReactNode;
  rotuloDoMarcar: string;
  marcado: boolean;
  desabilitado?: boolean;
  onAlternar: () => void;
  /** Valores: use <Mudanca> ou um bloco próprio (ex.: mini-colunas por mês). */
  valores: ReactNode;
  nota?: ReactNode;
  alerta?: ReactNode;
  /** Sugestão que pede conferência antes de usar (vem desmarcada): um selo âmbar, não o alerta vermelho. */
  conferir?: ReactNode;
  igual?: boolean;
};

export function Sugestao({ nome, rotuloDoMarcar, marcado, desabilitado = false, onAlternar, valores, nota, alerta, conferir, igual = false }: Props) {
  const classe = ["plan-sugestao", igual && "plan-sugestao-igual", desabilitado && "plan-sugestao-sem", marcado && "plan-sugestao-marcada", conferir && "plan-sugestao-conferir"].filter(Boolean).join(" ");
  return (
    <li className={classe}>
      <label className="plan-marcar plan-sugestao-marcar">
        <input type="checkbox" aria-label={rotuloDoMarcar} checked={marcado} disabled={desabilitado} onChange={onAlternar} />
      </label>
      <div className="plan-sugestao-corpo">
        <p className="plan-sugestao-nome">{nome}</p>
        {nota && <p className="plan-sugestao-nota">{nota}</p>}
        {conferir && <p className="plan-sugestao-conferir-texto">{conferir}</p>}
        {alerta && <p className="plan-sugestao-alerta">{alerta}</p>}
      </div>
      <div className="plan-sugestao-valores">{valores}</div>
    </li>
  );
}

type MudancaProps = { hoje: ReactNode; realizado: ReactNode; delta?: ReactNode; igual: boolean; semRealizado?: ReactNode };

/** "hoje 0% → 100%  +100 p.p." ou, sem mudança, "igual ao cenário · 28 dias". */
export function Mudanca({ hoje, realizado, delta, igual, semRealizado }: MudancaProps) {
  if (semRealizado) return <span className="plan-mudanca plan-mudanca-sem">{semRealizado}</span>;
  if (igual) return <span className="plan-mudanca plan-mudanca-igual"><span>igual ao cenário · {realizado}</span></span>;
  return (
    <span className="plan-mudanca">
      <span className="plan-mudanca-hoje"><span className="plan-mudanca-rotulo">hoje</span> {hoje}</span>
      <ArrowRight size={14} aria-hidden className="plan-mudanca-seta" />
      <span className="plan-sr">vai para</span>
      <strong className="plan-mudanca-novo">{realizado}</strong>
      {delta && <span className="plan-mudanca-delta">{delta}</span>}
    </span>
  );
}

export function CabecalhoDeSugestoes({ colunas }: { colunas: [string, string, string] }) {
  return (
    <div className="plan-sugestoes-cabecalho" aria-hidden>
      <span>{colunas[0]}</span>
      <span>{colunas[1]}</span>
      <span>{colunas[2]}</span>
    </div>
  );
}

/** Os grupos sem nada para sugerir numa linha só: não são decisão, não merecem um cartão cada. */
export function SemSugestao({ rotulo, nomes }: { rotulo: string; nomes: string[] }) {
  if (nomes.length === 0) return null;
  return (
    <p className="plan-sem-sugestao">
      <span className="plan-sem-sugestao-rotulo">{rotulo}:</span> {nomes.join(", ")}.
    </p>
  );
}

/** A busca do realizado falhou: o diálogo mostra só isso e a saída (tentar de novo), sem formulário vazio. */
export function ErroDoRealizado({ mensagem, carregando, onTentarDeNovo }: { mensagem: string; carregando: boolean; onTentarDeNovo: () => void }) {
  return (
    <Alert tone="error" role="alert" title="Não deu para buscar o realizado">
      {mensagem} Nada foi alterado no cenário.
      <span className="plan-salvar-acoes-alerta">
        <Button variant="secondary" disabled={carregando} onClick={onTentarDeNovo}><RefreshCw size={16} aria-hidden /> {carregando ? "Buscando…" : "Tentar de novo"}</Button>
      </span>
    </Alert>
  );
}

/** Rodapé preso ao pé do diálogo: o botão de aplicar e o resumo do que está marcado ficam sempre à vista. */
export function RodapeDoDialogo({ resumo, onCancelar, children }: { resumo: ReactNode; onCancelar: () => void; children?: ReactNode }) {
  return (
    <div className="plan-dialogo-acoes">
      {resumo && <p className="plan-dialogo-resumo" aria-live="polite">{resumo}</p>}
      <Button type="button" variant="secondary" onClick={onCancelar}>{children ? "Cancelar" : "Fechar"}</Button>
      {children}
    </div>
  );
}
