import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { saveDish, saveDishProductConversion, type DishCategory, type DishMenu, type DishDetail } from "../../../api/client";
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
import { novoIdDeLinha, useListaDeIngredientes } from "./useListaDeIngredientes";

export type ModoDoFormulario = "novo" | "editar" | "copia";

type Props = {
  modo: ModoDoFormulario;
  /** Prato aberto: base da edição ou da cópia. Nulo no prato novo. */
  base: DishDetail | null;
  categorias: DishCategory[];
  /** Cardápio de um prato novo: o que está selecionado na tela. */
  menuPadrao: DishMenu;
  onCancelar: () => void;
  onSalvo: (id: string, modo: ModoDoFormulario) => void;
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
  name: "", code: "", menu, categoryId: "", alsoMenu: null, alsoCategoryId: "", salePriceDefault: "", yieldQty: "1", yieldUnit: "UN", notes: ""
});

const itemDoDetalhe = (item: DishDetail["items"][number], copia: boolean): ItemDaFicha => ({
  tempId: copia ? novoIdDeLinha() : item.id,
  productId: item.productId,
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
      notes: base.notes ?? ""
    },
    itens: base.items.map((item) => itemDoDetalhe(item, copia)),
    itensDoOutro: (base.alsoItems ?? []).map((item) => itemDoDetalhe(item, copia))
  };
}

const titulos: Record<ModoDoFormulario, string> = {
  novo: "Novo prato",
  editar: "Editar ficha",
  copia: "Copiar ficha"
};

export function FormularioDoPrato({ modo, base, categorias, menuPadrao, onCancelar, onSalvo, onAlterado, notificar }: Props) {
  const inicial = useMemo(() => montarInicial(modo, base, menuPadrao), [modo, base, menuPadrao]);
  const instantaneoInicial = useRef(JSON.stringify(inicial));
  const [campos, setCampos] = useState<CamposDaFicha>(inicial.campos);
  // A quantidade do a la carte não é a do delivery: o prato vendido nos dois tem uma lista para cada cardápio.
  const salao = useListaDeIngredientes(inicial.itens);
  const delivery = useListaDeIngredientes(inicial.itensDoOutro);
  const itens = salao.itens;
  const itensDoOutro = delivery.itens;
  const [erros, setErros] = useState<ErrosDaFicha | null>(null);
  const [salvando, setSalvando] = useState(false);

  const alterado = JSON.stringify({ campos, itens, itensDoOutro }) !== instantaneoInicial.current;
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
          isActive: modo === "editar" ? base?.isActive : undefined
        }, itensDoOutro)
      );
      onSalvo(resultado.id, modo);
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
      <header className="ft-form-topo">
        <div>
          <h2 id="ft-form-titulo" className="ft-detalhe-nome">{titulos[modo]}</h2>
          {modo !== "novo" && base && (
            <p className="ft-detalhe-meta">
              <span>{modo === "copia" ? `A partir de “${base.name}”. Ajuste o nome e salve como um prato novo.` : base.name}</span>
            </p>
          )}
        </div>
        <IconButton icon={<X size={18} aria-hidden />} label="Fechar sem salvar" onClick={onCancelar} />
      </header>

      <section className="ft-secao" aria-labelledby="ft-dados">
        <h3 id="ft-dados" className="ft-secao-titulo">Dados do prato</h3>
        <FormGrid cols={2}>
          <FormField label="Nome do prato" required error={mostrarErros.name}>
            <TextField
              id="ft-nome"
              required
              value={campos.name}
              onChange={(evento) => alterarCampo("name", evento.target.value)}
              placeholder="Ex.: Risoto de camarão"
              maxLength={120}
            />
          </FormField>
          <FormField label="Código" hint="Opcional. Não pode repetir entre pratos.">
            <TextField value={campos.code} onChange={(evento) => alterarCampo("code", evento.target.value)} placeholder="Ex.: PRAT-001" maxLength={40} />
          </FormField>
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

          <FormField label="Rendimento" hint="Quantas porções a receita rende. O custo por porção divide por este número." error={mostrarErros.yieldQty}>
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
              value={campos.yieldUnit}
              onChange={(evento) => alterarCampo("yieldUnit", evento.target.value.toUpperCase())}
              maxLength={12}
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

      <SecaoDeIngredientes
        titulo={campos.alsoMenu ? "Ingredientes no a la carte" : "Ingredientes"}
        idBase="salao"
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
            <dt>Custo por porção</dt>
            <dd><Money value={resumo.custoPorPorcao} /></dd>
          </div>
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
            Custo parcial: ao menos um ingrediente está sem custo ou sem conversão de unidade, então o CMV real é maior que o mostrado.
          </p>
        )}

        <div className="ft-form-acoes">
          <Button variant="secondary" onClick={onCancelar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>
            {salvando ? "Salvando…" : modo === "editar" ? "Salvar alterações" : modo === "copia" ? "Salvar cópia" : "Criar prato"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
