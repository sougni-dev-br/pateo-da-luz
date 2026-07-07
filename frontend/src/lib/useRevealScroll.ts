import { useLayoutEffect, useRef, type RefObject } from "react";

type RevealScrollOptions = {
  when: unknown;
  focusSelector?: string;
  block?: ScrollLogicalPosition;
  behavior?: ScrollBehavior;
  skipIfVisible?: boolean;
  visibleThreshold?: number;
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isElementMostlyVisible(el: Element, threshold: number): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.height === 0) return false;
  const viewportH = window.innerHeight || document.documentElement.clientHeight;
  const visible = Math.max(0, Math.min(rect.bottom, viewportH) - Math.max(rect.top, 0));
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
    visibleThreshold = 0.6
  } = options;

  useLayoutEffect(() => {
    if (!when) return;
    const el = ref.current;
    if (!el || typeof window === "undefined") return;

    const raf = window.requestAnimationFrame(() => {
      const node = ref.current;
      if (!node) return;

      const effectiveBehavior: ScrollBehavior = behavior ?? (prefersReducedMotion() ? "auto" : "smooth");

      if (!skipIfVisible || !isElementMostlyVisible(node, visibleThreshold)) {
        try {
          node.scrollIntoView({ behavior: effectiveBehavior, block });
        } catch {
          node.scrollIntoView();
        }
      }

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
  }, [when, focusSelector, block, behavior, skipIfVisible, visibleThreshold]);

  return ref;
}
