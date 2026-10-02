import { render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { TipFolhaLiquidos } from "../../../api/client";

const FOLHA: TipFolhaLiquidos = {
  code: "GOR-2026-0001", label: "Gorjeta 26/08–25/09", total: 2000, extratos: [],
  etapas: { contabilidade: null, conferencia: null, folha: null } as unknown as TipFolhaLiquidos["etapas"],
  linhas: [
    { employeeId: "b", nome: "Beltrana Souza", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 2000, composicao: "x", pix: null, aviso: null },
    { employeeId: "c", nome: "Ciclano Lima", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 300, composicao: "x", pix: null, aviso: "Pago R$ 1.200,00 em 30/09; falta R$ 300,00." },
  ],
  jaPagos: [{ employeeId: "a", nome: "Fulano de Tal", grupo: "Sem registro", valor: 1000, pagoEm: "2026-09-30" }],
};
vi.mock("../../../api/client", () => ({ getTipFolhaLiquidos: vi.fn(async () => FOLHA), sincronizarSalariosCombinados: vi.fn() }));

import { FolhaLiquidos } from "../FolhaLiquidos";

test("quem já foi pago aparece à parte, fora da lista", async () => {
  render(<FolhaLiquidos year={2026} month={9} canEdit={false} liberada versao="1" onNotice={vi.fn()} />);
  const ja = await screen.findByRole("region", { name: "Já pagos" });
  const itens = within(ja).getAllByRole("listitem");
  expect(itens).toHaveLength(1);
  expect(itens[0].textContent).toMatch(/Fulano de Tal R\$\s?1\.000,00 em 30\/09/);
  expect(screen.queryAllByRole("cell", { name: "Fulano de Tal" })).toHaveLength(0);
});

test("linha paga a menos fica na lista com o aviso do que falta", async () => {
  render(<FolhaLiquidos year={2026} month={9} canEdit={false} liberada versao="1" onNotice={vi.fn()} />);
  expect(await screen.findByText("Pago R$ 1.200,00 em 30/09; falta R$ 300,00.")).toBeInTheDocument();
  expect(screen.getByText("Ciclano Lima")).toBeInTheDocument();
});
