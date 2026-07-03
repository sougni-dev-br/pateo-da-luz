import "@testing-library/jest-dom/vitest";

// jsdom não implementa APIs que o Radix (Popper/DropdownMenu/Dialog) exige.
// Mocks mínimos para os testes de componentes que abrem overlays.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
}

if (typeof window !== "undefined" && typeof window.PointerEvent === "undefined") {
  window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent;
}

if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => undefined);
}
