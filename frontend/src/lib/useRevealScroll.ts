import { useLayoutEffect, useRef, type RefObject } from "react";

type RevealScrollOptions = {
  when: unknown;
  focusSelector?: string;
  block?: ScrollLogicalPosition;
  behavior?: ScrollBehavior;
  skipIfVisible?: boolean;
  visibleThreshold?: number;
  /** Novo (opcional, default true). Se false, apenas rola; não move o foco. */
  focus?: boolean;
  /** Novo (opcional, default 0). Altura sticky no topo do scroll container. */
  topInset?: number;
  /** Novo (opcional, default 0). Altura sticky no rodapé do scroll container. */
  bottomInset?: number;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function findScrollContainer(el: Element): Element | null {
  let node: Element | null = el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

function isElementMostlyVisible(
  el: Element,
  threshold: number,
  topInset: number,
  bottomInset: number
): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.height === 0) return false;
  const container = findScrollContainer(el);
  const bounds = container
    ? container.getBoundingClientRect()
    : { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight };
  const topLimit = bounds.top + topInset;
  const bottomLimit = bounds.bottom - bottomInset;
  // Se o topo do elemento está encoberto pela sticky-toolbar, não considera visível
  // mesmo que a maior parte da área esteja no viewport útil.
  const TOP_TOLERANCE = 4;
  if (rect.top < topLimit - TOP_TOLERANCE) return false;
  const visible = Math.max(0, Math.min(rect.bottom, bottomLimit) - Math.max(rect.top, topLimit));
  return visible / rect.height >= threshold;
}

function findFocusTarget(root: HTMLElement, selector?: string): HTMLElement | null {
  if (selector) {
    const match = root.querySelector<HTMLElement>(selector);
    if (match) return match;
  }
  const auto = root.querySelector<HTMLElement>("[data-autofocus]");
  if (auto) return auto;
  const heading = root.querySelector<HTMLElement>("h1, h2, h3");
  if (heading) {
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    return heading;
  }
  return null;
}

export function useRevealScroll<T extends HTMLElement = HTMLElement>(
  options: RevealScrollOptions
): RefObject<T> {
  const ref = useRef<T>(null);
  const {
    when,
    focusSelector,
    block = "start",
    behavior,
    skipIfVisible = true,
    visibleThreshold = 0.6,
    focus = true,
    topInset = 0,
    bottomInset = 0
  } = options;

  useLayoutEffect(() => {
    if (!when) return;
    const el = ref.current;
    if (!el || typeof window === "undefined") return;

    const raf = window.requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;

      const effectiveBehavior: ScrollBehavior = behavior ?? (prefersReducedMotion() ? "auto" : "smooth");

      if (!skipIfVisible || !isElementMostlyVisible(node, visibleThreshold, topInset, bottomInset)) {
        try {
          node.scrollIntoView({ behavior: effectiveBehavior, block });
        } catch {
          node.scrollIntoView();
        }
      }

      if (!focus) return;

      const focusTarget = findFocusTarget(node, focusSelector);
      if (focusTarget) {
        try {
          focusTarget.focus({ preventScroll: true });
        } catch {
          focusTarget.focus();
        }
      }
    });

    return () => window.cancelAnimationFrame(raf);
  }, [when, focusSelector, block, behavior, skipIfVisible, visibleThreshold, focus, topInset, bottomInset]);

  return ref;
}
