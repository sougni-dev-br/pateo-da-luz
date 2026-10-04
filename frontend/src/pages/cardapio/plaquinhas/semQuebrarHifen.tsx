import { Fragment, type ReactNode } from "react";

// "alho-poró", "batata-doce", "grão-de-bico": o navegador quebra a linha depois do hífen e a
// palavra sai partida ("alho-" / "poró"). Cada palavra com hífen vira um bloco que não quebra.
const PALAVRA_COM_HIFEN = /(\S*\p{L}-\p{L}\S*)/u;

export function semQuebrarHifen(texto: string): ReactNode {
  if (!texto.includes("-")) return texto;
  return texto.split(PALAVRA_COM_HIFEN).map((parte, i) =>
    i % 2 === 1 ? <span key={i} className="plq-sem-quebra">{parte}</span> : <Fragment key={i}>{parte}</Fragment>,
  );
}

// Mesma regra para o molde de medição, que é montado direto no DOM.
export function preencherSemQuebrarHifen(el: HTMLElement, texto: string): void {
  el.textContent = "";
  texto.split(PALAVRA_COM_HIFEN).forEach((parte, i) => {
    if (!parte) return;
    if (i % 2 === 1) {
      const span = document.createElement("span");
      span.className = "plq-sem-quebra";
      span.textContent = parte;
      el.appendChild(span);
    } else {
      el.appendChild(document.createTextNode(parte));
    }
  });
}
