import { AlertTriangle, ChevronDown, Copy, RotateCcw, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../design-system";
import { AvisoComDesfazer } from "./AvisoComDesfazer";
import { comPonto } from "./erros";

// Barra fixa no pé da tela enquanto há alteração não salva. A falha ao salvar entra NA barra, numa linha (o detalhe
// abre sob demanda), para não cobrir as subabas. No conflito só aparecem as duas saídas seguras: salvar como cópia ou
// abrir a versão salva; o "Salvar cenário" some, porque gravaria por cima do trabalho de outra pessoa.

export type FalhaAoSalvar = { tipo: "conflito" | "erro"; mensagem: string };

type Props = {
  sujo: boolean;
  salvando: boolean;
  podeEditar: boolean;
  podeCriar: boolean;
  caixaValida: boolean;
  falha: FalhaAoSalvar | null;
  onSalvar: () => void;
  onDescartar: () => void;
  onSalvarComoCopia: () => void;
  /** Leva até o mix das formas (aba Caixa) quando é ele que bloqueia o salvar. */
  onVerMix?: () => void;
  /** Aviso de troca em massa com Desfazer: entra na pilha, acima da barra, nunca por cima dela. */
  aviso?: { texto: string; onDesfazer: () => void; onFechar: () => void } | null;
};

function Falha({ falha, salvando, podeCriar, caixaValida, onSalvar, onDescartar, onSalvarComoCopia }: Omit<Props, "sujo" | "podeEditar" | "aviso" | "onVerMix"> & { falha: FalhaAoSalvar }) {
  const [detalhe, setDetalhe] = useState(false);
  useEffect(() => setDetalhe(false), [falha]);
  const conflito = falha.tipo === "conflito";
  // No celular o conflito cabe numa linha curta, ao lado do "Detalhes"; a frase inteira fica no computador.
  const resumo = conflito
    ? <><span className="plan-so-largo">Outra pessoa salvou este cenário antes de você.</span><span className="plan-so-estreito">Alguém salvou antes de você.</span></>
    : "O cenário não foi salvo.";
  const explicacao = conflito
    ? "Para não apagar o trabalho da outra pessoa, salve as suas como um cenário novo, ou abra a versão salva (as suas se perdem)."
    : "Confira a conexão e tente de novo.";

  return (
    <div className={`plan-salvar-linha plan-salvar-falha plan-salvar-${falha.tipo}`}>
      <div className="plan-salvar-texto">
        <p className="plan-salvar-estado" role="alert">
          <AlertTriangle size={16} aria-hidden className="plan-salvar-icone" />
          <span>{resumo} <span className="plan-salvar-suave plan-salvar-suave-longo">Suas alterações continuam na tela.</span></span>
        </p>
        <button type="button" className="plan-salvar-detalhe-botao" aria-expanded={detalhe} onClick={() => setDetalhe((d) => !d)}>
          {detalhe ? "Menos" : "Detalhes"} <ChevronDown size={14} aria-hidden className={detalhe ? "plan-girado" : undefined} />
        </button>
        {detalhe && <p className="plan-salvar-detalhe">{comPonto(falha.mensagem)} {explicacao}</p>}
      </div>
      <div className="plan-salvar-botoes">
        {conflito ? (
          <>
            {podeCriar && <Button onClick={onSalvarComoCopia}><Copy size={16} aria-hidden /> Salvar as minhas como cópia</Button>}
            <Button variant="secondary" className="plan-salvar-secundaria" onClick={onDescartar}><RotateCcw size={16} aria-hidden /> Abrir a versão salva</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" disabled={salvando} onClick={onDescartar}>Descartar</Button>
            <Button onClick={onSalvar} disabled={salvando || !caixaValida}><Save size={16} aria-hidden /> {salvando ? "Salvando…" : "Tentar de novo"}</Button>
          </>
        )}
      </div>
    </div>
  );
}

const FOLGA_DO_FOCO_PX = 12;
const ALTURA_MAXIMA_DE_CONTROLE_PX = 120;

/** Quem rola a página: o primeiro ancestral com rolagem vertical de verdade (no shell, o contêiner do conteúdo). */
function roladorDe(elemento: HTMLElement): HTMLElement {
  for (let el = elemento.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight) return el;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

/** O campo em foco nunca fica atrás da barra (WCAG 2.4.11): se ele passa do topo da barra, a página sobe o que falta. */
function revelarFocoAcimaDa(barra: HTMLElement) {
  const ativo = document.activeElement;
  if (!(ativo instanceof HTMLElement) || ativo === document.body || barra.contains(ativo)) return;
  if (!ativo.closest(".plan")) return;
  const topoDaBarra = barra.getBoundingClientRect().top;
  const caixaDoCampo = ativo.getBoundingClientRect();
  const excesso = caixaDoCampo.bottom + FOLGA_DO_FOCO_PX - topoDaBarra;
  // Só controles (campo, botão): um quadro inteiro em foco é mais alto que a tela e não cabe acima da barra.
  if (excesso > 0 && caixaDoCampo.height <= ALTURA_MAXIMA_DE_CONTROLE_PX) roladorDe(ativo).scrollBy({ top: excesso });
}

/**
 * No celular a barra fica fixa na tela (o contêiner que rola no shell passa do fim da tela e cortaria uma barra
 * "sticky"). A página reserva embaixo o espaço do topo da barra até o fim do contêiner que rola (inclusive o pedaço
 * dele que fica fora da tela), para o último campo poder subir acima da barra. E, a cada foco ou mudança de tamanho
 * da barra, o campo em foco é trazido para cima dela.
 */
function useBarraSemCobrirOFoco(visivel: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const barra = ref.current;
    const pai = barra?.parentElement;
    if (!visivel || !barra || !pai) return undefined;
    let quadro = 0;
    const medir = () => {
      const topoDaBarra = barra.getBoundingClientRect().top;
      const fimDoRolador = Math.max(window.innerHeight, roladorDe(pai).getBoundingClientRect().bottom);
      const reserva = Math.max(barra.getBoundingClientRect().height, fimDoRolador - topoDaBarra) + FOLGA_DO_FOCO_PX;
      pai.style.setProperty("--plan-altura-salvar", `${Math.round(reserva)}px`);
      revelarFocoAcimaDa(barra);
    };
    const depoisDoFoco = () => { cancelAnimationFrame(quadro); quadro = requestAnimationFrame(() => revelarFocoAcimaDa(barra)); };
    medir();
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    observador?.observe(barra);
    document.addEventListener("focusin", depoisDoFoco);
    return () => {
      observador?.disconnect();
      cancelAnimationFrame(quadro);
      document.removeEventListener("focusin", depoisDoFoco);
      pai.style.removeProperty("--plan-altura-salvar");
    };
  }, [visivel]);
  return ref;
}

export function BarraDeSalvar({ sujo, salvando, podeEditar, podeCriar, caixaValida, falha, onSalvar, onDescartar, onSalvarComoCopia, onVerMix, aviso }: Props) {
  const visivel = sujo || falha !== null || Boolean(aviso);
  const ref = useBarraSemCobrirOFoco(visivel);
  if (!visivel) return null;

  return (
    <div ref={ref} className="plan-salvar" role="region" aria-label="Alterações do cenário">
      {aviso && <AvisoComDesfazer texto={aviso.texto} onDesfazer={aviso.onDesfazer} onFechar={aviso.onFechar} />}
      {falha ? (
        <Falha falha={falha} salvando={salvando} podeCriar={podeCriar} caixaValida={caixaValida} onSalvar={onSalvar} onDescartar={onDescartar} onSalvarComoCopia={onSalvarComoCopia} />
      ) : sujo && (
        <div className="plan-salvar-linha">
          <p className="plan-salvar-estado">
            <span className="plan-salvar-ponto" aria-hidden />
            {podeEditar ? "Alterações não salvas" : "Alterações só nesta tela: você não pode salvar este cenário"}
            {podeEditar && !caixaValida && <span className="plan-salvar-bloqueio"> · o mix das formas de pagamento precisa somar 100% para salvar</span>}
            {podeEditar && !caixaValida && onVerMix && <button type="button" className="plan-salvar-detalhe-botao" onClick={onVerMix}>Ver o mix</button>}
          </p>
          <div className="plan-salvar-botoes">
            <Button variant="secondary" disabled={salvando} onClick={onDescartar}>Descartar</Button>
            {podeEditar && (
              <Button onClick={onSalvar} disabled={salvando || !caixaValida}>
                <Save size={16} aria-hidden /> {salvando ? "Salvando…" : "Salvar cenário"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
