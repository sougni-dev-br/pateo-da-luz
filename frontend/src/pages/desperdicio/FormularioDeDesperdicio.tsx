import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import type { WasteInput, WasteProductHit, WasteReason } from "../../api/client";
import { Button, Select, TextField, Textarea } from "../../design-system";
import { hojeLocalIso } from "../../lib/datas";
import { normalizarUnidade } from "../../lib/fichaTecnica";
import { BuscaProdutoDesperdicio, type ModoDoItem } from "./BuscaProdutoDesperdicio";
import { SeletorDeFoto } from "./FotoDoDesperdicio";
import { MOTIVOS, erroDaQuantidade } from "./motivos";
import { medidasDaMesmaGrandeza, opcoesDoLancamento, precisaInformar, previaDaConversao } from "./quantidade";

type Valores = { modo: ModoDoItem; produto: WasteProductHit | null; quantidade: string; unidade: string; peso: string; pesoUnidade: string; motivo: WasteReason | ""; dia: string; observacao: string };

const valoresVazios = (modo: ModoDoItem = "INSUMO", dia = hojeLocalIso()): Valores => ({ modo, produto: null, quantidade: "", unidade: "", peso: "", pesoUnidade: "G", motivo: "", dia, observacao: "" });

// ids estáveis: ligam cada erro ao seu campo (aria-describedby) e permitem levar o foco ao primeiro inválido.
const ID = { busca: "waste-busca", quantidade: "waste-quantidade", unidade: "waste-unidade", peso: "waste-peso", pesoUnidade: "waste-peso-unidade", data: "waste-data", motivos: "waste-motivos", observacao: "waste-observacao" } as const;

type Props = {
  /** Devolve `true` quando o lançamento foi registrado (o formulário limpa); `false` mantém o que a pessoa digitou. */
  onSalvar: (dados: WasteInput, itemEscolhido: WasteProductHit, modo: ModoDoItem, foto: File | null) => Promise<boolean>;
};

const MENSAGEM_DA_QUANTIDADE = {
  VAZIA: "Informe a quantidade.",
  MILHAR: "Use vírgula para decimais (1,5). \"1.500\" é ambíguo.",
  INVALIDA: "Informe uma quantidade maior que zero (até 4 casas decimais).",
} as const;

export function FormularioDeDesperdicio({ onSalvar }: Props) {
  const [valores, setValores] = useState<Valores>(valoresVazios);
  const [foto, setFoto] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const hoje = hojeLocalIso();

  const conversoes = valores.produto?.conversions ?? [];
  // Item que ainda não converte a unidade escolhida: a pessoa diz quanto vale 1 unidade do estoque, ali mesmo.
  const informar = valores.produto ? precisaInformar(valores.unidade, valores.produto.unit, conversoes) : false;
  const unidadeDoEstoque = valores.produto ? normalizarUnidade(valores.produto.unit) : "";
  // "1 porção" para prato em UN; "1 UN", "1 PCT"... para insumo.
  const rotuloDaUnidade = valores.modo === "PRATO" && unidadeDoEstoque === "UN" ? "porção" : unidadeDoEstoque;

  const erros = useMemo(() => {
    const quantidade = erroDaQuantidade(valores.quantidade);
    const erroDoPeso = informar ? erroDaQuantidade(valores.peso) : null;
    return {
      produto: valores.produto ? null : valores.modo === "PRATO" ? "Escolha o prato." : "Escolha o produto.",
      quantidade: quantidade ? MENSAGEM_DA_QUANTIDADE[quantidade] : null,
      peso: erroDoPeso ? (erroDoPeso === "VAZIA" ? `Informe quanto pesa ou mede 1 ${rotuloDaUnidade}.` : MENSAGEM_DA_QUANTIDADE[erroDoPeso]) : null,
      data: !valores.dia || valores.dia > hoje ? "Informe a data (hoje ou antes)." : null,
      motivo: valores.motivo ? null : "Escolha o motivo.",
      observacao: valores.motivo === "OTHER" && !valores.observacao.trim() ? "Descreva o que aconteceu." : null,
    };
  }, [valores, hoje, informar, rotuloDaUnidade]);

  // Na ordem da tela: é onde o foco cai quando o envio é recusado.
  const ordem: Array<[keyof typeof erros, string]> = [["produto", ID.busca], ["quantidade", ID.quantidade], ["peso", ID.peso], ["data", ID.data], ["motivo", `${ID.motivos}-primeiro`], ["observacao", ID.observacao]];
  const invalidos = ordem.filter(([campo]) => erros[campo]);
  const mostrar = (campo: keyof typeof erros) => (tentou ? erros[campo] : null);

  function mudar(parcial: Partial<Valores>) {
    setValores((atual) => ({ ...atual, ...parcial }));
  }

  async function enviar(event: React.FormEvent) {
    event.preventDefault();
    setTentou(true);
    if (invalidos.length > 0 || !valores.produto || !valores.motivo) {
      // O primeiro erro recebe o foco: o leitor de tela o lê (via aria-describedby) e quem digita não precisa caçá-lo.
      window.requestAnimationFrame(() => document.getElementById(invalidos[0]?.[1] ?? "")?.focus());
      return;
    }
    const dados: WasteInput = {
      ...(valores.modo === "PRATO" ? { dishId: valores.produto.id } : { productId: valores.produto.id }),
      quantity: valores.quantidade, ...(valores.unidade ? { unit: valores.unidade } : {}), ...(informar ? { perUnit: { quantity: valores.peso, unit: valores.pesoUnidade } } : {}), reason: valores.motivo, occurredOn: valores.dia, notes: valores.observacao,
    };
    setSalvando(true);
    try {
      const registrado = await onSalvar(dados, valores.produto, valores.modo, foto);
      if (registrado) {
        // Mantém a data e o modo: quem lança o fechamento do dia faz vários seguidos do mesmo tipo.
        setValores(valoresVazios(valores.modo, valores.dia));
        setFoto(null);
        setTentou(false);
      }
    } finally {
      setSalvando(false);
    }
  }

  const opcoesDeUnidade = valores.produto ? opcoesDoLancamento(valores.produto.unit, conversoes).map((o) => ({ value: o.value, label: o.label })) : [];
  const previa = valores.produto
    ? previaDaConversao({
        quantidade: valores.quantidade,
        unidade: valores.unidade,
        unidadeDoEstoque: valores.produto.unit,
        conversoes,
        pesoPorUnidade: informar ? { quantidade: valores.peso, unidade: valores.pesoUnidade } : null,
      })
    : null;
  const origemDoPeso = valores.produto?.embalagemInferida && normalizarUnidade(valores.unidade) === normalizarUnidade(valores.produto.unit) ? valores.produto.embalagemInferida : null;

  const resumoDosErros = tentou && invalidos.length > 0 ? `Falta preencher: ${invalidos.map(([campo]) => ({ produto: valores.modo === "PRATO" ? "prato" : "produto", quantidade: "quantidade", peso: `peso de 1 ${rotuloDaUnidade}`, data: "data", motivo: "motivo", observacao: "observação" })[campo]).join(", ")}.` : null;

  return (
    <form className="waste-form" onSubmit={enviar} noValidate>
      <h2>Novo desperdício</h2>

      <div className="waste-modes" role="group" aria-label="O que foi desperdiçado">
        {([["INSUMO", "Insumo"], ["PRATO", "Prato pronto"]] as const).map(([modo, rotulo]) => (
          <button
            key={modo}
            type="button"
            aria-pressed={valores.modo === modo}
            className={valores.modo === modo ? "waste-mode waste-mode-on" : "waste-mode"}
            onClick={() => { if (valores.modo !== modo) mudar({ modo, produto: null, unidade: "", peso: "" }); }}
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div className="waste-field">
        <span className="waste-label">{valores.modo === "PRATO" ? "Prato" : "Produto"}</span>
        <BuscaProdutoDesperdicio
          key={valores.modo}
          modo={valores.modo}
          selecionado={valores.produto}
          idDoCampo={ID.busca}
          idDoErro="waste-erro-produto"
          invalido={Boolean(mostrar("produto"))}
          onSelecionar={(produto) => {
            // Começa na unidade do estoque do item; a pessoa troca para g, ml... se for o caso.
            mudar({ produto, unidade: produto ? normalizarUnidade(produto.unit) : "", peso: "" });
            // Escolhido o item, a próxima coisa a preencher é a quantidade.
            if (produto) window.requestAnimationFrame(() => document.getElementById(ID.quantidade)?.focus());
          }}
        />
        {mostrar("produto") && <small id="waste-erro-produto" className="waste-error">{erros.produto}</small>}
      </div>

      <div className="waste-row">
        <TextField
          id={ID.quantidade}
          label="Quantidade"
          inputMode="decimal"
          value={valores.quantidade}
          onChange={(event) => mudar({ quantidade: event.target.value })}
          error={mostrar("quantidade") ?? undefined}
          placeholder="0,0"
          autoComplete="off"
          containerClassName="waste-area-qtd"
        />
        <Select
          id={ID.unidade}
          label="Unidade"
          value={valores.unidade}
          options={opcoesDeUnidade}
          placeholder={valores.produto ? undefined : "—"}
          disabled={opcoesDeUnidade.length <= 1}
          onChange={(event) => mudar({ unidade: event.target.value, pesoUnidade: normalizarUnidade(event.target.value) })}
          containerClassName="waste-area-un"
        />
        <TextField
          id={ID.data}
          label="Data"
          type="date"
          value={valores.dia}
          max={hoje}
          onChange={(event) => mudar({ dia: event.target.value })}
          error={mostrar("data") ?? undefined}
          containerClassName="waste-area-data"
        />
      </div>
      {informar && (
        <div className="waste-peso">
          <p className="waste-peso-titulo">Este item ainda não tem {valores.unidade === "ML" || valores.unidade === "L" ? "volume" : "peso"} cadastrado. Diga uma vez quanto vale 1 {rotuloDaUnidade}:</p>
          <div className="waste-peso-campos">
            <span className="waste-peso-igual" aria-hidden>1 {rotuloDaUnidade} =</span>
            <TextField
              id={ID.peso}
              label={`Quanto pesa ou mede 1 ${rotuloDaUnidade}`}
              inputMode="decimal"
              value={valores.peso}
              onChange={(event) => mudar({ peso: event.target.value })}
              error={mostrar("peso") ?? undefined}
              placeholder="0,0"
              autoComplete="off"
              containerClassName="waste-area-peso"
            />
            <Select
              id={ID.pesoUnidade}
              label="Medida"
              value={valores.pesoUnidade}
              options={medidasDaMesmaGrandeza(valores.unidade).map((m) => ({ value: m, label: m }))}
              onChange={(event) => mudar({ pesoUnidade: event.target.value })}
              containerClassName="waste-area-peso-un"
            />
          </div>
          <p className="waste-hint">Vale para este lançamento. Quem é da gestão grava no cadastro do produto e o sistema não pergunta de novo.</p>
        </div>
      )}
      {(previa || origemDoPeso) && (
        <p className="waste-hint" role="status">
          {previa?.texto}{previa && valores.produto?.embalagemInferida ? ` · ${valores.produto.embalagemInferida}` : ""}{!previa && origemDoPeso ? origemDoPeso : ""}
        </p>
      )}

      <fieldset className="waste-field waste-reasons" aria-describedby={mostrar("motivo") ? "waste-erro-motivo" : undefined}>
        <legend className="waste-label">Motivo</legend>
        <div className="waste-chips" id={ID.motivos}>
          {MOTIVOS.map((motivo, indice) => {
            const ativo = valores.motivo === motivo.value;
            return (
              <button
                key={motivo.value}
                id={indice === 0 ? `${ID.motivos}-primeiro` : undefined}
                type="button"
                aria-pressed={ativo}
                className={ativo ? "waste-chip waste-chip-on" : "waste-chip"}
                onClick={() => mudar({ motivo: motivo.value })}
              >
                {ativo && <Check size={15} aria-hidden />}
                {motivo.label}
              </button>
            );
          })}
        </div>
        {mostrar("motivo") && <small id="waste-erro-motivo" className="waste-error">{erros.motivo}</small>}
      </fieldset>

      <SeletorDeFoto arquivo={foto} onEscolher={setFoto} desabilitado={salvando} />

      <Textarea
        id={ID.observacao}
        label={valores.motivo === "OTHER" ? "O que aconteceu" : "Observação (opcional)"}
        rows={2}
        maxLength={500}
        value={valores.observacao}
        onChange={(event) => mudar({ observacao: event.target.value })}
        error={mostrar("observacao") ?? undefined}
      />

      {/* Fixa no pé da tela no celular: o botão não some atrás da rolagem depois de 8 motivos e a foto. */}
      <div className="waste-submit">
        {resumoDosErros && <p className="waste-error" role="alert">{resumoDosErros}</p>}
        <Button type="submit" variant="primary" disabled={salvando}>{salvando ? "Registrando…" : "Registrar desperdício"}</Button>
      </div>
    </form>
  );
}
