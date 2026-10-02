import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import type { TipFolhaLiquidos } from "../../../api/client";

const FOLHA: TipFolhaLiquidos = {
  code: "GOR-2026-0001", label: "Gorjeta 26/08–25/09", total: 2000, extratos: [],
  etapas: { contabilidade: null, conferencia: null, folha: null } as unknown as TipFolhaLiquidos["etapas"],
  linhas: [{ employeeId: "b", nome: "Beltrana Souza", grupo: "Sem registro", origem: "SEM_REGISTRO", valor: 2000, composicao: "x", pix: null, aviso: null }],
  jaPagos: [{ employeeId: "a", nome: "Fulano de Tal", grupo: "Sem registro", valor: 1000, pagoEm: "2026-09-30" }],
};
vi.mock("../../../api/client", () => ({ getTipFolhaLiquidos: vi.fn(async () => FOLHA), sincronizarSalariosCombinados: vi.fn() }));

import { FolhaLiquidos } from "../FolhaLiquidos";

test("quem já foi pago aparece à parte, fora da lista", async () => {
  render(<FolhaLiquidos year={2026} month={9} canEdit={false} liberada versao="1" onNotice={vi.fn()} />);
  const ja = await screen.findByLabelText("Já pagos");
  expect(ja.textContent).toMatch(/Fulano de Tal R\$\s?1\.000,00 em 30\/09/);
  expect(screen.queryAllByRole("cell", { name: "Fulano de Tal" })).toHaveLength(0);
});
