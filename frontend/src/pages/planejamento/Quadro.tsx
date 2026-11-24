import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

// Moldura das tabelas do Planejamento: uma região rolável que recebe foco (quem usa teclado também rola a tabela
// larga) e, quando há campos, navega como planilha: setas mudam de célula, Enter desce, Shift+Enter sobe.

const SELETOR_DE_CAMPO = "input.plan-campo:not(:disabled)";

type Posicao = { linha: number; coluna: number };

function posicaoDe(campo: HTMLInputElement): Posicao | null {
  const celula = campo.closest("td, th") as HTMLTableCellElement | null;
  const linha = celula?.parentElement as HTMLTableRowElement | null;
  if (!celula || !linha) return null;
  return { linha: linha.rowIndex, coluna: celula.cellIndex };
}

/** Texto todo selecionado (o foco seleciona tudo) ou cursor na borda: aí a seta lateral troca de célula. */
function podeSairPelaLateral(campo: HTMLInputElement, direcao: -1 | 1): boolean {
  const inicio = campo.selectionStart ?? 0;
  const fim = campo.selectionEnd ?? 0;
  const tudo = inicio === 0 && fim === campo.value.length;
  if (tudo) return true;
  if (inicio !== fim) return false;
  return direcao < 0 ? inicio === 0 : fim === campo.value.length;
}

function destinoNaGrade(campos: HTMLInputElement[], de: Posicao, passo: { linha: number; coluna: number }): HTMLInputElement | null {
  const posicoes = campos.map((c) => ({ campo: c, pos: posicaoDe(c) }));
  if (passo.linha !== 0) {
    const naColuna = posicoes.filter((p) => p.pos && p.pos.coluna === de.coluna && Math.sign(p.pos.linha - de.linha) === passo.linha);
    naColuna.sort((a, b) => passo.linha * ((a.pos?.linha ?? 0) - (b.pos?.linha ?? 0)));
    return naColuna[0]?.campo ?? null;
  }
  const naLinha = posicoes.filter((p) => p.pos && p.pos.linha === de.linha && Math.sign(p.pos.coluna - de.coluna) === passo.coluna);
  naLinha.sort((a, b) => passo.coluna * ((a.pos?.coluna ?? 0) - (b.pos?.coluna ?? 0)));
  return naLinha[0]?.campo ?? null;
}

export function navegarNaGrade(evento: KeyboardEvent<HTMLElement>) {
  const alvo = evento.target;
  if (!(alvo instanceof HTMLInputElement) || !alvo.matches(SELETOR_DE_CAMPO)) return;
  if (evento.altKey || evento.ctrlKey || evento.metaKey) return;
  const de = posicaoDe(alvo);
  if (!de) return;
  let passo: { linha: number; coluna: number } | null = null;
  if (evento.key === "ArrowDown" || (evento.key === "Enter" && !evento.shiftKey)) passo = { linha: 1, coluna: 0 };
  else if (evento.key === "ArrowUp" || (evento.key === "Enter" && evento.shiftKey)) passo = { linha: -1, coluna: 0 };
  else if (evento.key === "ArrowLeft" && podeSairPelaLateral(alvo, -1)) passo = { linha: 0, coluna: -1 };
  else if (evento.key === "ArrowRight" && podeSairPelaLateral(alvo, 1)) passo = { linha: 0, coluna: 1 };
  if (!passo) return;
  const campos = Array.from(evento.currentTarget.querySelectorAll<HTMLInputElement>(SELETOR_DE_CAMPO));
  const destino = destinoNaGrade(campos, de, passo);
  if (!destino) return;
  evento.preventDefault();
  destino.focus();
  destino.scrollIntoView({ block: "nearest", inline: "nearest" });
}

type Props = { rotulo: string; className?: string; editavel?: boolean; children: ReactNode };

/** Há mais tabela escondida à esquerda/direita? Liga as sombras de rolagem das bordas. */
function useBordasDeRolagem() {
  const ref = useRef<HTMLDivElement>(null);
  const [bordas, setBordas] = useState({ esquerda: false, direita: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => {
      const esquerda = el.scrollLeft > 1;
      const direita = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setBordas((atual) => (atual.esquerda === esquerda && atual.direita === direita ? atual : { esquerda, direita }));
    };
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const observador = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    observador?.observe(el);
    const tabela = el.querySelector("table");
    if (tabela) observador?.observe(tabela);
    return () => { el.removeEventListener("scroll", medir); observador?.disconnect(); };
  }, []);
  return { ref, bordas };
}

export function Quadro({ rotulo, className, editavel = false, children }: Props) {
  const { ref, bordas } = useBordasDeRolagem();
  return (
    <div className="plan-quadro-moldura" data-rola-esquerda={bordas.esquerda || undefined} data-rola-direita={bordas.direita || undefined}>
      <div
        ref={ref}
        role="region"
        aria-label={editavel ? `${rotulo}. Use as setas para mudar de célula e Enter para descer.` : rotulo}
        tabIndex={0}
        className={["plan-quadro", className].filter(Boolean).join(" ")}
        onKeyDown={editavel ? navegarNaGrade : undefined}
      >
        {children}
      </div>
    </div>
  );
}
