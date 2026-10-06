import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AgendaDay } from "../../../../api/client";

// Painel de eventos: agenda do mês e diálogo do dia. Eventos fictícios (repositório público).
vi.mock("../../../../api/client", () => ({
  getEventsAgenda: vi.fn(),
  saveOperationDay: vi.fn(async () => ({ date: "2026-10-07" })),
  matchEventSeries: vi.fn(async () => []),
  createEventEdition: vi.fn(),
}));

import { getEventsAgenda, saveOperationDay } from "../../../../api/client";
import { Agenda } from "../Agenda";
import { dataBr, diaDoEvento, lerPreco, nomeDoBuffet, reais, ticket } from "../formato";

const limites = { smallMaxLunch: 80, largeMinLunch: 150, lunchCapacity: null };
const evento = (dia: number, total: number) => ({
  seriesId: "s1", seriesName: "Feira de Exemplo", origin: "CENTRO_CONVENCOES" as const, posicao: "MEIO" as const,
  editionId: "e1", editionTitle: "3ª Feira de Exemplo", dia, totalDias: total, startTime: "08:00", endTime: "18:00",
});
const previsao = (almoco: number, tamanho: "PEQUENO" | "MEDIO" | "GRANDE") => ({ almoco, minimo: almoco - 20, maximo: almoco + 20, tamanho, base: "Em edições anteriores, Feira de Exemplo teve 160 almoços no dia do meio (2 dias)", casos: 5, poucaBase: false });

function dia(date: string, extra: Partial<AgendaDay> = {}): AgendaDay {
  return { date, eventos: [], previsao: null, realizado: null, escala: null, buffetCobrado: null, decisao: null, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00"));
});

describe("agenda do mês", () => {
  test("mostra a sugestão e avisa quando a Escala marca outro tamanho", async () => {
    vi.mocked(getEventsAgenda).mockResolvedValue({
      limites,
      dias: [
        dia("2026-10-01"),
        dia("2026-10-07", { eventos: [evento(2, 3)], previsao: previsao(170, "GRANDE"), escala: "MEDIO" }),
        dia("2026-10-08", { eventos: [evento(3, 3)], previsao: previsao(90, "MEDIO"), escala: "MEDIO" }),
      ],
    });
    render(<Agenda podeEditar podeCriar onAbrirEvento={vi.fn()} />);
    expect(await screen.findAllByText("Feira de Exemplo")).toHaveLength(2);
    // O dia sem evento, sem marcação e sem comentário fica de fora com o filtro ligado.
    expect(screen.queryByRole("button", { name: "Abrir o dia 01/10/2026" })).toBeNull();
    expect(screen.getByText("dia com a Escala diferente da sugestão").previousSibling).toHaveTextContent("1");
    expect(screen.getByTitle("A marcação da Escala é diferente da sugestão")).toBeInTheDocument();
  });

  test("mês que já passou mostra quantas vezes a previsão acertou o tamanho", async () => {
    vi.mocked(getEventsAgenda).mockResolvedValue({
      limites,
      dias: [
        dia("2026-09-10", { eventos: [evento(1, 2)], previsao: previsao(170, "GRANDE"), realizado: { fonte: "PDV", almocos: 188, valorAlmoco: 17000, jantares: 16, valorJantar: 900 } }),
        dia("2026-09-11", { eventos: [evento(2, 2)], previsao: previsao(170, "GRANDE"), realizado: { fonte: "PDV", almocos: 120, valorAlmoco: 11000, jantares: 26, valorJantar: 1500 } }),
      ],
    });
    render(<Agenda podeEditar podeCriar onAbrirEvento={vi.fn()} />);
    expect(await screen.findByText("1 de 2")).toBeInTheDocument();
  });

  test("no acerto vale a previsão congelada quando o dia foi salvo, não a de hoje", async () => {
    vi.mocked(getEventsAgenda).mockResolvedValue({
      limites,
      dias: [dia("2026-09-10", {
        eventos: [evento(1, 1)], previsao: previsao(170, "GRANDE"),
        decisao: { serviceMode: "BUFFET", buffetPrice: null, notes: null, forecastLunch: 120, forecastSize: "MEDIO" },
        realizado: { fonte: "PDV", almocos: 120, valorAlmoco: 11000, jantares: 10, valorJantar: 600 },
      })],
    });
    render(<Agenda podeEditar podeCriar onAbrirEvento={vi.fn()} />);
    expect(await screen.findByText("1 de 1")).toBeInTheDocument();
    expect(screen.getByText("dias em que a previsão acertou o tamanho")).toBeInTheDocument();
  });

  test("salvar o dia manda modalidade, preço com vírgula e comentário", async () => {
    vi.mocked(getEventsAgenda).mockResolvedValue({ limites, dias: [dia("2026-10-07", { eventos: [evento(2, 3)], previsao: previsao(170, "GRANDE") })] });
    render(<Agenda podeEditar podeCriar onAbrirEvento={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o dia 07/10/2026" }));
    const dialogo = await screen.findByRole("dialog");
    fireEvent.change(within(dialogo).getByLabelText("Modalidade"), { target: { value: "BUFFET" } });
    fireEvent.change(within(dialogo).getByLabelText(/^Preço do buffet/), { target: { value: "82,90" } });
    fireEvent.change(within(dialogo).getByLabelText("Comentário da gerência"), { target: { value: "Parceria com a organização" } });
    fireEvent.click(within(dialogo).getByRole("button", { name: "Salvar o dia" }));
    await waitFor(() => expect(saveOperationDay).toHaveBeenCalledWith("2026-10-07", { serviceMode: "BUFFET", buffetPrice: 82.9, notes: "Parceria com a organização" }));
  });

  test("o preço do buffet vem do PDV e substitui o campo de digitar", async () => {
    const buffetCobrado = { principal: { produto: "BUFFET PROMO", preco: 89.9, vendidos: 100 }, outros: [{ produto: "BUFFET GRUPO", preco: 79.9, vendidos: 4 }] };
    vi.mocked(getEventsAgenda).mockResolvedValue({ limites, dias: [dia("2026-09-30", { eventos: [evento(1, 1)], buffetCobrado, realizado: { fonte: "PDV", almocos: 120, valorAlmoco: 11000, jantares: 10, valorJantar: 600 } })] });
    render(<Agenda podeEditar podeCriar onAbrirEvento={vi.fn()} />);
    const linha = await screen.findByRole("button", { name: "Abrir o dia 30/09/2026" });
    expect(linha).toHaveTextContent(/Buffet R\$\s?89,90/);
    fireEvent.click(linha);
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByLabelText("Preço do buffet")).toBeNull();
    expect(within(dialogo).getByText("cobrado no PDV")).toBeInTheDocument();
    expect(within(dialogo).getByText(/Também: Grupo R\$\s?79,90 \(4\)/)).toBeInTheDocument();
  });

  test("sem permissão de editar, o dia abre só para leitura", async () => {
    vi.mocked(getEventsAgenda).mockResolvedValue({ limites, dias: [dia("2026-10-07", { eventos: [evento(2, 3)] })] });
    render(<Agenda podeEditar={false} podeCriar={false} onAbrirEvento={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Lançar evento da circular/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir o dia 07/10/2026" }));
    const dialogo = await screen.findByRole("dialog");
    expect(within(dialogo).queryByRole("button", { name: "Salvar o dia" })).toBeNull();
    expect(within(dialogo).getByLabelText("Comentário da gerência")).toBeDisabled();
  });
});

describe("formatação", () => {
  test("datas, dia do evento e dinheiro", () => {
    expect(dataBr("2026-10-07")).toBe("07/10/2026");
    expect(diaDoEvento(2, 3)).toBe("2º de 3");
    expect(diaDoEvento(1, 1)).toBe("1 dia");
    expect(reais(null)).toBe("—");
    expect(ticket(1000, 0)).toBe("—");
    expect(ticket(1000, 10)).toMatch(/100,00/);
  });

  test("preço com vírgula, com ponto de milhar ou com ponto decimal do celular", () => {
    expect(lerPreco("82,90")).toBe(82.9);
    expect(lerPreco("1.082,90")).toBe(1082.9);
    expect(lerPreco("82.90")).toBe(82.9);
    expect(lerPreco("R$ 79,90")).toBe(79.9);
    expect(lerPreco("  ")).toBeNull();
    expect(lerPreco("oitenta")).toBeNaN();
  });

  test("nome do buffet sem a palavra buffet", () => {
    expect(nomeDoBuffet("BUFFET PROMO 15")).toBe("Promo 15");
    expect(nomeDoBuffet("BUFFET")).toBe("Buffet");
  });
});
