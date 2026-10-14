import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getDishFichaSuggestions, saveDish, saveDishProductConversion, type DishCategory, type DishMenu, type DishDetail, type FichaSuggestion, type SaveDishResult } from "../../../api/client";
import { Button, FormField, FormGrid, IconButton, Money, Select, StatusBadge, TextField, Textarea } from "../../../design-system";
import {
  faixaDeCmv,
  fracaoParaPercentual,
  ondeVende,
  trocarOndeVende,
  type OndeVende,
  montarPayloadDaFicha,
  normalizarUnidade,
  resumoDaFicha,
  temErros,
  validarFicha,
  type CamposDaFicha,
  type ErrosDaFicha,
  type ItemDaFicha
} from "../../../lib/fichaTecnica";
import { formatPercent } from "../../../utils/format";
import { DESCRICAO_DO_CARDAPIO, ROTULO_DO_CARDAPIO, opcoesDeCategoria } from "../../../lib/categoriasDasFichas";
import { SecaoDeIngredientes } from "./SecaoDeIngredientes";
import { SugestaoDeFicha } from "./SugestaoDeFicha";
import { novoIdDeLinha, useListaDeIngredientes } from "./useListaDeIngredientes";

export type ModoDoFormulario = "novo" | "editar" | "copia";

type Props = {
  modo: ModoDoFormulario;
  /** Prato aberto: base da edição ou da cópia. Nulo no prato novo. */
  base: DishDetail | null;
  categorias: DishCategory[];
  /** Cardápio de um prato novo: o que está selecionado na tela. */
  menuPadrao: DishMenu;
  /** Ficha nova de produção (a massa do nhoque): sem preço, categoria nem cardápio. Numa ficha já gravada vale o tipo dela. */
  producao?: boolean;
  onCancelar: () => void;
  /** `virouProducao`: um prato vendido foi convertido em ficha de produção nesta gravação. */
  onSalvo: (id: string, modo: ModoDoFormulario, desperdicio?: SaveDishResult["desperdicio"], virouProducao?: boolean) => void;
  onAlterado: (alterado: boolean) => void;
  notificar: (tom: "success" | "error", mensagem: string) => void;
};

/** Acima disso o prato dá prejuízo só de ingrediente: quase sempre é unidade errada, não receita. */
const CMV_ABSURDO = 100;
const UNIDADES_DE_RENDIMENTO = ["UN", "PORÇÃO", "KG", "L", "G", "ML"];
const MAXIMO_DE_ATALHOS_DE_PRECO = 4;

const OPCOES_ONDE_VENDE: Array<{ valor: OndeVende; rotulo: string; titulo: string }> = [
  { valor: "CARDAPIO", rotulo: ROTULO_DO_CARDAPIO.CARDAPIO, titulo: DESCRICAO_DO_CARDAPIO.CARDAPIO },
  { valor: "DELIVERY", rotulo: ROTULO_DO_CARDAPIO.DELIVERY, titulo: DESCRICAO_DO_CARDAPIO.DELIVERY },
  { valor: "AMBOS", rotulo: "Cardápio e delivery", titulo: "O mesmo prato vendido no salão e no delivery, com uma ficha só" }
];

const camposVazios = (menu: DishMenu): CamposDaFicha => ({
  name: "", code: "", menu, categoryId: "", alsoMenu: null, alsoCategoryId: "", salePriceDefault: "", yieldQty: "1", yieldUnit: "UN", portionWeightG: "", shelfLifeDays: "", notes: ""
});

const itemDoDetalhe = (item: DishDetail["items"][number], copia: boolean): ItemDaFicha => ({
  tempId: copia ? novoIdDeLinha() : item.id,
  productId: item.productId ?? "",
  componentDishId: item.componentDishId ?? null,
  ehFicha: Boolean(item.componentDishId),
  motivoDaFicha: item.componentDishId ? item.issue : null,
  productName: item.productName,
  quantity: String(item.quantity),
  unit: normalizarUnidade(item.unit) || item.unit,
  wasteFactor: fracaoParaPercentual(item.wasteFactor),
  unitCost: item.unitCost ?? 0,
  productUnit: item.productUnit,
  conversions: item.conversions ?? [],
  embalagemInferida: item.embalagemInferida ?? null,
  notes: item.notes ?? ""
});

function montarInicial(modo: ModoDoFormulario, base: DishDetail | null, menuPadrao: DishMenu): { campos: CamposDaFicha; itens: ItemDaFicha[]; itensDoOutro: ItemDaFicha[] } {
  if (!base || modo === "novo") return { campos: camposVazios(menuPadrao), itens: [], itensDoOutro: [] };

  const copia = modo === "copia";
  return {
    campos: {
      name: copia ? `Cópia de ${base.name}` : base.name,
      // O código é único: a cópia nasce sem ele para não repetir o do original.
      code: copia ? "" : base.code ?? "",
      menu: base.menu,
      categoryId: base.category?.id ?? "",
      alsoMenu: base.alsoMenu ?? null,
      alsoCategoryId: base.alsoCategory?.id ?? "",
      salePriceDefault: base.salePriceDefault != null ? String(base.salePriceDefault) : "",
      yieldQty: String(base.yieldQty),
      yieldUnit: base.yieldUnit,
      portionWeightG: base.portionWeightG != null ? String(base.portionWeightG) : "",
      shelfLifeDays: base.shelfLifeDays != null ? String(base.shelfLifeDays) : "",
      notes: base.notes ?? ""
    },
    itens: base.items.map((item) => itemDoDetalhe(item, copia)),
    itensDoOutro: (base.alsoItems ?? []).map((item) => itemDoDetalhe(item, copia))
  };
}

const titulosDeProducao: Record<ModoDoFormulario, string> = {
  novo: "Nova ficha de produção",
  editar: "Editar ficha de produção",
  copia: "Copiar ficha de produção"
};

const titulos: Record<ModoDoFormulario, string> = {
  novo: "Novo prato",
  editar: "Editar ficha",
  copia: "Copiar ficha"
};

export function FormularioDoPrato({ modo, base, categorias, menuPadrao, producao = false, onCancelar, onSalvo, onAlterado, notificar }: Props) {
  // Prato vendido que passa a ser ficha de produção: só vale ao salvar; o servidor recusa se ele tiver preço nos canais.
  const [converter, setConverter] = useState(false);
  const podeConverter = modo === "editar" && base != null && !base.fichaDeProducao && !base.fichaDeBuffet;
  const ehProducao = base ? Boolean(base.fichaDeProducao) || converter : producao;
  const inicial = useMemo(() => montarInicial(modo, base, menuPadrao), [modo, base, menuPadrao]);
  const instantaneoInicial = useRef(JSON.stringify(inicial));
  const [campos, setCampos] = useState<CamposDaFicha>(inicial.campos);
  // A quantidade do a la carte não é a do delivery: o prato vendido nos dois tem uma lista para cada cardápio.
  const salao = useListaDeIngredientes(inicial.itens);
  const delivery = useListaDeIngredientes(inicial.itensDoOutro);
  const itens = salao.itens;
  const itensDoOutro = delivery.itens;
  // Ingredientes que o prato copiou de uma ficha de produção (a massa do nhoque ÷ 12): a tela oferece trocá-los pela ficha.
  const [sugestoesDeFicha, setSugestoesDeFicha] = useState<FichaSuggestion[]>([]);
  const idDaFichaEmEdicao = modo === "editar" ? base?.id : undefined;
  useEffect(() => {
    if (!idDaFichaEmEdicao) return undefined;
    let ativo = true;
    // É uma ajuda: se falhar, a ficha abre normalmente sem a sugestão.
    getDishFichaSuggestions(idDaFichaEmEdicao).then((achadas) => { if (ativo) setSugestoesDeFicha(achadas); }).catch(() => undefined);
    return () => { ativo = false; };
  }, [idDaFichaEmEdicao]);

  function trocarPorFicha(sugestao: FichaSuggestion) {
    const linha: ItemDaFicha = {
      tempId: novoIdDeLinha(),
      productId: "",
      componentDishId: sugestao.componentDishId,
      ehFicha: true,
      motivoDaFicha: sugestao.motivo,
      productName: sugestao.name,
      quantity: String(sugestao.quantity),
      unit: normalizarUnidade(sugestao.unit) || sugestao.unit,
      wasteFactor: "0",
      unitCost: sugestao.unitCost,
      productUnit: sugestao.unit,
      conversions: [],
      embalagemInferida: null,
      notes: ""
    };
    // A linha da ficha entra onde estava o primeiro dos ingredientes trocados, para a ordem da receita não mudar.
    salao.setItens((anterior) => {
      const posicao = anterior.findIndex((item) => sugestao.itemIds.includes(item.tempId));
      const restantes = anterior.filter((item) => !sugestao.itemIds.includes(item.tempId));
      return [...restantes.slice(0, Math.max(posicao, 0)), linha, ...restantes.slice(Math.max(posicao, 0))];
    });
    setSugestoesDeFicha((atuais) => atuais.filter((outra) => outra.componentDishId !== sugestao.componentDishId));
    setAnuncio(`Trocado por “${sugestao.name}”.`);
    // A sugestão desmonta junto com o botão: o foco vai para a quantidade da linha nova.
    window.setTimeout(() => document.getElementById(`ft-qtd-${linha.tempId}`)?.focus(), 0);
  }
  const [anuncio, setAnuncio] = useState("");
  const [erros, setErros] = useState<ErrosDaFicha | null>(null);
  const [salvando, setSalvando] = useState(false);

  const alterado = converter || JSON.stringify({ campos, itens, itensDoOutro }) !== instantaneoInicial.current;
  useEffect(() => { onAlterado(alterado); }, [alterado, onAlterado]);
  useEffect(() => () => onAlterado(false), [onAlterado]);

  // O botão que abriu o formulário sai da tela: sem isto o foco cai no <body> e quem usa
  // teclado volta ao começo da página. A cópia já seleciona o nome para renomear direto.
  useEffect(() => {
    const campo = document.getElementById("ft-nome") as HTMLInputElement | null;
    campo?.focus();
    if (modo === "copia") campo?.select();
  }, [modo]);

  // Depois da primeira tentativa de salvar, os erros acompanham a digitação.
  const errosVisiveis = useMemo(() => (erros ? validarFicha(campos, itens, itensDoOutro) : null), [erros, campos, itens, itensDoOutro]);
  const resumo = useMemo(() => resumoDaFicha(campos, itens), [campos, itens]);
  const faixa = faixaDeCmv(resumo.cmvPercentual);
  // O custo do delivery sai das quantidades do delivery, sem preço: o preço de lá é por loja.
  const resumoDoOutro = useMemo(() => resumoDaFicha({ salePriceDefault: "", yieldQty: campos.yieldQty }, itensDoOutro), [campos.yieldQty, itensDoOutro]);

  // Preços já praticados nos canais: um toque preenche o preço padrão.
  const atalhosDePreco = useMemo(() => {
    if (modo !== "editar" || !base) return [];
    const vistos = new Set<number>();
    return base.listings
      .filter((listagem) => listagem.isActive)
      .filter((listagem) => !vistos.has(listagem.price) && vistos.add(listagem.price))
      .slice(0, MAXIMO_DE_ATALHOS_DE_PRECO);
  }, [modo, base]);

  // Uma categoria por cardápio em que o prato é vendido, só com as categorias daquele cardápio.
  const cardapiosDoPrato: Array<{ menu: DishMenu; campo: "categoryId" | "alsoCategoryId" }> = [
    { menu: campos.menu, campo: "categoryId" },
    ...(campos.alsoMenu ? [{ menu: campos.alsoMenu, campo: "alsoCategoryId" as const }] : [])
  ];

  function trocarOndeVender(novo: OndeVende) {
    // A lista de cima é sempre a do cardápio principal. Quando o principal muda de cardápio, as listas trocam de lugar:
    // senão as quantidades do salão seriam gravadas como se fossem as do delivery (e apagariam as de lá), ou o inverso.
    const ficaOutro = campos.alsoMenu && novo === campos.alsoMenu;
    const virouAmbos = novo === "AMBOS" && campos.menu === "DELIVERY";
    if (ficaOutro || virouAmbos) {
      const doPrincipal = itens;
      salao.setItens(ficaOutro ? itensDoOutro : []);
      delivery.setItens(doPrincipal);
    }
    setCampos((anterior) => trocarOndeVende(anterior, novo));
  }

  function alterarCampo(campo: keyof CamposDaFicha, valor: string) {
    setCampos((anterior) => ({ ...anterior, [campo]: valor }));
  }

  /** "1 UN = 1.200 g": grava no produto e atualiza todas as linhas desse produto, nas duas listas da ficha. */
  async function informarConversao(productId: string, unidade: string, quantidade: number, substituir?: boolean) {
    const resposta = await saveDishProductConversion(productId, { unit: unidade, amount: quantidade, ...(substituir ? { replace: true } : {}) });
    const atualizar = (anterior: ItemDaFicha[]) => anterior.map((item) => (
      item.productId === productId
        ? { ...item, conversions: resposta.conversions, embalagemInferida: resposta.embalagemInferida }
        : item
    ));
    salao.setItens(atualizar);
    delivery.setItens(atualizar);
    notificar("success", "Conversão salva no produto. Vale para todas as fichas e para a conversão de compras e contagem.");
  }

  /** Ponto de partida do delivery: as linhas do a la carte, para ajustar — a quantidade de lá não vale para cá. */
  function comecarDaFichaDoSalao() {
    delivery.setItens(itens.map((item) => ({ ...item, tempId: novoIdDeLinha(), avisoDeConversao: null })));
  }

  function focarPrimeiroErro(encontrados: ErrosDaFicha) {
    const [idDoItem, erroDoItem] = Object.entries(encontrados.itens)[0] ?? [];
    const alvo = encontrados.name
      ? "ft-nome"
      : encontrados.salePriceDefault
        ? "ft-preco"
        : encontrados.yieldQty
          ? "ft-rendimento"
          : encontrados.portionWeightG
            ? "ft-peso-porcao"
            : encontrados.shelfLifeDays
              ? "ft-validade"
              : encontrados.semQuantidadesDoOutro
            ? "ft-busca-ingrediente-delivery"
            : `${erroDoItem?.campo === "wasteFactor" ? "ft-perda" : "ft-qtd"}-${idDoItem}`;
    // O erro só aparece depois do render seguinte.
    window.setTimeout(() => document.getElementById(alvo)?.focus(), 0);
  }

  async function salvar() {
    const encontrados = validarFicha(campos, itens, itensDoOutro);
    setErros(encontrados);
    if (temErros(encontrados)) {
      focarPrimeiroErro(encontrados);
      return;
    }

    setSalvando(true);
    try {
      const resultado = await saveDish(
        montarPayloadDaFicha(campos, itens, {
          id: modo === "editar" ? base?.id : undefined,
          isActive: modo === "editar" ? base?.isActive : undefined,
          fichaDeProducao: ehProducao
        }, itensDoOutro)
      );
      onSalvo(resultado.id, modo, resultado.desperdicio, converter);
    } catch (erro) {
      notificar("error", erro instanceof Error ? erro.message : "Não foi possível salvar a ficha.");
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Enter num campo não envia a ficha: salvar é um clique deliberado. Numa linha de
   * ingrediente ele leva à busca, que é o passo seguinte de quem está montando a receita.
   */
  function aoTeclarNoFormulario(evento: KeyboardEvent<HTMLFormElement>) {
    if (evento.key !== "Enter" || !(evento.target instanceof HTMLInputElement)) return;
    evento.preventDefault();
    // Enter numa linha leva à busca da MESMA lista (a do salão e a do delivery são seções separadas).
    if (evento.target.closest(".ft-ingrediente")) {
      evento.target.closest(".ft-secao")?.querySelector<HTMLInputElement>('input[role="combobox"]')?.focus();
    }
  }

  const mostrarErros = errosVisiveis ?? { itens: {} };

  return (
    <form
      className="ft-form"
      noValidate
      onSubmit={(evento) => { evento.preventDefault(); void salvar(); }}
      onKeyDown={aoTeclarNoFormulario}
      aria-labelledby="ft-form-titulo"
    >
      <p className="ft-sr-only" role="status" aria-live="polite">{anuncio}</p>
      <header className="ft-form-topo">
        <div>
          <h2 id="ft-form-titulo" className="ft-detalhe-nome">{ehProducao ? titulosDeProducao[modo] : titulos[modo]}</h2>
          {modo !== "novo" && base && (
            <p className="ft-detalhe-meta">
              <span>{modo === "copia" ? `A partir de “${base.name}”. Ajuste o nome e salve como ${ehProducao ? "uma ficha de produção nova" : "um prato novo"}.` : base.name}</span>
            </p>
          )}
        </div>
        <IconButton icon={<X size={18} aria-hidden />} label="Fechar sem salvar" onClick={onCancelar} />
      </header>

      <section className="ft-secao" aria-labelledby="ft-dados">
        <h3 id="ft-dados" className="ft-secao-titulo">{ehProducao ? "Dados da ficha de produção" : "Dados do prato"}</h3>
        {podeConverter && (
          <div className="ft-converter">
            {converter ? (
              <>
                <p className="ft-explica">
                  Ao salvar, “{base?.name}” deixa de ser um prato vendido e vira ficha de produção: perde o preço e a categoria, sai do cardápio, da margem e do CMV por canal,
                  e passa a poder ser ingrediente de outras fichas. Não dá se ela tiver preço nos canais de venda.
                </p>
                <Button variant="secondary" size="sm" onClick={() => setConverter(false)}>Desfazer</Button>
              </>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setConverter(true)}>Tornar ficha de produção</Button>
            )}
          </div>
        )}
        {modo === "editar" && (base?.usadaEm?.length ?? 0) > 0 && (
          <p className="ft-explica" role="note">
            <strong>Esta ficha é ingrediente de {base?.usadaEm?.length} {base?.usadaEm?.length === 1 ? "ficha" : "fichas"}</strong>
            {" "}({base?.usadaEm?.map((uso) => uso.name).join(", ")}). Mudar o rendimento ou os ingredientes muda o custo de todas elas, e a unidade de rendimento fica travada enquanto estiver em uso.
          </p>
        )}
        {ehProducao && !converter && (
          <p className="ft-explica">
            Ficha de produção é um preparo que não se vende (a massa do nhoque, um molho base). Ela não tem preço, categoria nem CMV:
            informe o que ela rende e os ingredientes, e o custo de cada unidade entra no CMV dos pratos que a usarem como ingrediente.
          </p>
        )}
        <FormGrid cols={2}>
          <FormField label={ehProducao ? "Nome da ficha" : "Nome do prato"} required error={mostrarErros.name}>
            <TextField
              id="ft-nome"
              required
              value={campos.name}
              onChange={(evento) => alterarCampo("name", evento.target.value)}
              placeholder={ehProducao ? "Ex.: Nhoque - Massa" : "Ex.: Risoto de camarão"}
              maxLength={120}
            />
          </FormField>
          <FormField label="Código" hint="Opcional. Não pode repetir entre pratos.">
            <TextField value={campos.code} onChange={(evento) => alterarCampo("code", evento.target.value)} placeholder="Ex.: PRAT-001" maxLength={40} />
          </FormField>
          {!ehProducao && (<>
          <div className="ft-campo-cheio">
            <FormField label="Cardápio" hint="Salão e delivery têm categorias e preços próprios. Se o mesmo prato sai nos dois, escolha “Cardápio e delivery”: a ficha tem as quantidades do a la carte e as do delivery, cada uma no seu cardápio.">
              <div className="ft-segmentos" role="radiogroup" aria-label="Cardápio do prato">
                {OPCOES_ONDE_VENDE.map(({ valor, rotulo, titulo }) => (
                  <button
                    key={valor}
                    type="button"
                    role="radio"
                    aria-checked={ondeVende(campos) === valor}
                    className="ft-segmento"
                    onClick={() => trocarOndeVender(valor)}
                    title={titulo}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </FormField>
          </div>
          {cardapiosDoPrato.map(({ menu, campo }) => {
            const opcoes = opcoesDeCategoria(categorias, menu, campos[campo]);
            return (
              <FormField
                key={campo}
                label={cardapiosDoPrato.length === 1 ? "Categoria" : `Categoria no ${menu === "DELIVERY" ? "delivery" : "cardápio"}`}
                hint={opcoes.length === 0 ? `${menu === "DELIVERY" ? "O delivery" : "Este cardápio"} ainda não tem categorias. Crie na aba Categorias.` : undefined}
              >
                <Select
                  value={campos[campo]}
                  onChange={(evento) => alterarCampo(campo, evento.target.value)}
                  options={opcoes}
                  placeholder="Sem categoria"
                />
              </FormField>
            );
          })}
          <FormField
            label={campos.menu === "DELIVERY" && !campos.alsoMenu ? "Preço base (R$)" : "Preço no salão (R$)"}
            hint={campos.menu === "DELIVERY" && !campos.alsoMenu
              ? "Por porção. O delivery tem preço por loja: depois de salvar, lance cada um na ficha do prato."
              : campos.alsoMenu
                ? "Preço do salão, por porção. O preço de cada loja do delivery é lançado na ficha do prato, depois de salvar."
                : "Por porção. Em branco, a ficha não calcula margem nem CMV."}
            error={mostrarErros.salePriceDefault}
          >
            <TextField
              id="ft-preco"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={campos.salePriceDefault}
              onChange={(evento) => alterarCampo("salePriceDefault", evento.target.value)}
              placeholder="0,00"
            />
          </FormField>

          {atalhosDePreco.length > 0 && (
            <div className="ft-atalhos-preco" role="group" aria-label="Preços praticados nos canais">
              <span>Praticado nos canais:</span>
              {atalhosDePreco.map((listagem) => (
                <button
                  key={listagem.id}
                  type="button"
                  className="ft-chip"
                  onClick={() => alterarCampo("salePriceDefault", String(listagem.price))}
                  title={`Usar o preço de ${listagem.storeName ?? "tabela"} como preço de venda`}
                >
                  {listagem.storeName ? `${listagem.storeName.replace(/^Pateo\s+(da\s+)?/i, "")} · ` : ""}
                  R$ {listagem.price.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </button>
              ))}
            </div>
          )}

          </>)}
          <FormField
            label="Rendimento"
            hint={ehProducao ? "Quanto a receita rende (ex.: 12 UN, 5 KG). O custo de cada unidade divide por este número, e é assim que o prato a usa." : "Quantas porções a receita rende. O custo por porção divide por este número."}
            error={mostrarErros.yieldQty}
          >
            <TextField
              id="ft-rendimento"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={campos.yieldQty}
              onChange={(evento) => alterarCampo("yieldQty", evento.target.value)}
            />
          </FormField>
          <FormField label="Unidade do rendimento">
            <TextField
              list="ft-unidades-rendimento"
              disabled={modo === "editar" && (base?.usadaEm?.length ?? 0) > 0}
              value={campos.yieldUnit}
              onChange={(evento) => alterarCampo("yieldUnit", evento.target.value.toUpperCase())}
              maxLength={12}
            />
          </FormField>
          <FormField label="Peso da porção (g)" hint="Opcional. Quanto pesa cada porção pronta; com ele a ficha mostra o custo por kg." error={mostrarErros.portionWeightG}>
            <TextField
              id="ft-peso-porcao"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="Ex.: 160"
              value={campos.portionWeightG}
              onChange={(evento) => alterarCampo("portionWeightG", evento.target.value)}
            />
          </FormField>
          <FormField label="Validade de uso (dias)" hint="Opcional. Por quantos dias o preparo pode ser usado." error={mostrarErros.shelfLifeDays}>
            <TextField
              id="ft-validade"
              type="number"
              inputMode="numeric"
              step="1"
              min="1"
              placeholder="Ex.: 4"
              value={campos.shelfLifeDays}
              onChange={(evento) => alterarCampo("shelfLifeDays", evento.target.value)}
            />
          </FormField>
          {/* Fora do FormField: com dois filhos ele não consegue ligar o rótulo ao campo. */}
          <datalist id="ft-unidades-rendimento">
            {UNIDADES_DE_RENDIMENTO.map((unidade) => <option key={unidade} value={unidade} />)}
          </datalist>
          <div className="ft-campo-cheio">
            <FormField label="Observações" hint="Modo de preparo, cuidados, o que não está na lista de ingredientes.">
              <Textarea value={campos.notes} onChange={(evento) => alterarCampo("notes", evento.target.value)} rows={3} />
            </FormField>
          </div>
        </FormGrid>
      </section>

      <SugestaoDeFicha sugestoes={sugestoesDeFicha} itens={itens} originais={inicial.itens} onTrocar={trocarPorFicha} />

      <SecaoDeIngredientes
        titulo={campos.alsoMenu ? "Ingredientes no a la carte" : "Ingredientes"}
        idBase="salao"
        excluirId={idDaFichaEmEdicao}
        itens={itens}
        repetidos={salao.repetidos}
        idsNaFicha={salao.idsNaFicha}
        erros={mostrarErros.itens}
        descricao={campos.alsoMenu ? "Quantidades da porção servida no salão (a la carte)." : undefined}
        onAdicionar={salao.adicionar}
        onAlterar={salao.alterar}
        onRemover={salao.remover}
        onInformarConversao={informarConversao}
      />

      {campos.alsoMenu && (
        <SecaoDeIngredientes
          titulo="Ingredientes no delivery"
          idBase="delivery"
          rotuloDaBusca="Buscar produto para adicionar à ficha do delivery"
          excluirId={idDaFichaEmEdicao}
          itens={itensDoOutro}
          repetidos={delivery.repetidos}
          idsNaFicha={delivery.idsNaFicha}
          erros={mostrarErros.itens}
          erroDaLista={mostrarErros.semQuantidadesDoOutro}
          descricao="Obrigatório. As quantidades do a la carte não valem para o delivery: informe as da porção que sai nele."
          acoes={itens.length > 0 && itensDoOutro.length === 0 ? (
            <Button variant="secondary" size="sm" onClick={comecarDaFichaDoSalao}>Começar da ficha do a la carte</Button>
          ) : undefined}
          onAdicionar={delivery.adicionar}
          onAlterar={delivery.alterar}
          onRemover={delivery.remover}
          onInformarConversao={informarConversao}
        />
      )}

      <footer className="ft-form-rodape">
        <dl className="ft-resumo" aria-label="Resumo calculado da ficha">
          <div>
            <dt>{ehProducao ? `Custo por ${campos.yieldUnit || "unidade"}` : "Custo por porção"}</dt>
            <dd><Money value={resumo.custoPorPorcao} /></dd>
          </div>
          {!ehProducao && (<>
          <div>
            <dt>Margem</dt>
            <dd>{resumo.margemBruta == null ? "—" : <Money value={resumo.margemBruta} />}</dd>
          </div>
          <div>
            <dt>CMV</dt>
            <dd>
              {resumo.cmvPercentual == null
                ? "—"
                : resumo.incompleto
                  ? formatPercent(resumo.cmvPercentual)
                  : <StatusBadge tone={faixa?.tom ?? "neutral"}>{formatPercent(resumo.cmvPercentual)}</StatusBadge>}
            </dd>
          </div>
          </>)}
          {campos.alsoMenu && itensDoOutro.length > 0 && (
            <div>
              <dt>Custo no delivery</dt>
              <dd><Money value={resumoDoOutro.custoPorPorcao} /></dd>
            </div>
          )}
          {itens.length > 1 && (
            <div className="ft-resumo-receita">
              <dt>Receita inteira</dt>
              <dd><Money value={resumo.custoDaReceita} /></dd>
            </div>
          )}
        </dl>

        {resumo.cmvPercentual != null && resumo.cmvPercentual > CMV_ABSURDO && (
          <p className="ft-resumo-aviso ft-resumo-aviso--erro" role="alert">
            O custo por porção passou muito do preço de venda. Confira as quantidades e as unidades (200 g digitado como 200 UN, por exemplo).
          </p>
        )}

        {resumo.incompleto && itens.length > 0 && (
          <p className="ft-resumo-aviso" role="status">
            Custo parcial: ao menos um ingrediente está sem custo ou sem conversão de unidade, então o custo real é maior que o mostrado.
          </p>
        )}

        <div className="ft-form-acoes">
          <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>
            {salvando ? "Salvando…" : modo === "editar" ? "Salvar alterações" : modo === "copia" ? "Salvar cópia" : ehProducao ? "Criar ficha de produção" : "Criar prato"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
