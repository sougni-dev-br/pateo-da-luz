import { act, fireEvent } from "@testing-library/react";

// O projeto não tem @testing-library/user-event: estas ações cobrem o que os testes dos comentários precisam.
export const acoes = {
  async click(el: Element) { await act(async () => { fireEvent.click(el); }); },
  async clear(el: Element) { await act(async () => { fireEvent.change(el, { target: { value: "" } }); }); },
  async type(el: Element, texto: string) {
    const atual = (el as HTMLTextAreaElement).value;
    await act(async () => { fireEvent.change(el, { target: { value: atual + texto } }); });
  },
  async escape() { await act(async () => { fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" }); }); }
};
