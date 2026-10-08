import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { saveDish, type DishCategory, type DishDetail, type DishProductSearchResult } from "../../../api/client";
import { Button, FormField, FormGrid, IconButton, Money, Select, StatusBadge, TextField, Textarea } from "../../../design-system";
import {
  faixaDeCmv,
  fracaoParaPercentual,
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
import { BuscaDeIngrediente } from "./BuscaDeIngrediente";
import { LinhaDeIngrediente } from "./LinhaDeIngrediente";

export type ModoDoFormulario = "novo" | "editar" | "copia";

type Props = {
  modo: ModoDoFormulario;
  /** Prato aberto: base da edição ou da cópia. Nulo no prato novo. */
  base: DishDetail | null;
  categorias: DishCategory[];
  onCancelar: () => void;
  onSalvo: (id: string, modo: ModoDoFormulario) => void;
  onAlterado: (alterado: boolean) => void;
  notificar: (tom: "success" | "error", mensagem: string) => void;
};

/** Acima disso o prato dá prejuízo só de ingrediente: quase sempre é unidade errada, não receita. */
const CMV_ABSURDO = 100;
const UNIDADES_DE_RENDIMENTO = ["UN", "PORÇÃO", "KG", "L", "G", "ML"];
const MAXIMO_DE_ATALHOS_DE_PRECO = 4;

const CAMPOS_VAZIOS: CamposDaFicha = {
  name: "", code: "", categoryId: "", salePriceDefault: "", yieldQty: "1", yieldUnit: "UN", notes: ""
};

let sequenciaDeLinhas = 0;
const novoIdDeLinha = () => `novo-${Date.now()}-${++sequenciaDeLinhas}`;

function montarInicial(modo: ModoDoFormulario, base: DishDetail | null): { campos: CamposDaFicha; itens: ItemDaFicha[] } {
  if (!base || modo === "novo") return { campos: CAMPOS_VAZIOS, itens: [] };

  const copia = modo === "copia";
  return {
    campos: {
      name: copia ? `Cópia de ${base.name}` : base.name,
      // O código é único: a cópia nasce sem ele para não repetir o do original.
      code: copia ? "" : base.code ?? "",
      categoryId: base.category?.id ?? "",
      salePriceDefault: base.salePriceDefault != null ? String(base.salePriceDefault) : "",
      yieldQty: String(base.yieldQty),
      yieldUnit: base.yieldUnit,
      notes: base.notes ?? ""
    },
    itens: base.items.map((item) => ({
      tempId: copia ? novoIdDeLinha() : item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: String(item.quantity),
      unit: normalizarUnidade(item.unit) || item.unit,
      wasteFactor: fracaoParaPercentual(item.wasteFactor),
      unitCost: item.unitCost ?? 0,
      productUnit: item.productUnit,
      conversions: item.conversions ?? [],
      notes: item.notes ?? ""
    }))
  };
}

const titulos: Record<ModoDoFormulario, string> = {
  novo: "Novo prato",
  editar: "Editar ficha",
  copia: "Copiar ficha"
};

export function FormularioDoPrato({ modo, base, categorias, onCancelar, onSalvo, onAlterado, notificar }: Props) {
  const inicial = useMemo(() => montarInicial(modo, base), [modo, base]);
  const instantaneoInicial = useRef(JSON.stringify(inicial));
  const [campos, setCampos] = useState<CamposDaFicha>(inicial.campos);
  const [itens, setItens] = useState<ItemDaFicha[]>(inicial.itens);
  const [erros, setErros] = useState<ErrosDaFicha | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [focoNaLinha, setFocoNaLinha] = useState<string | null>(null);

  const alterado = JSON.stringify({ campos, itens }) !== instantaneoInicial.current;
  useEffect(() => { onAlterado(alterado); }, [alterado, onAlterado]);
  useEffect(() => () => onAlterado(false), [onAlterado]);

  // O botão que abriu o formulário sai da tela: sem isto o foco cai no <body> e quem usa
  // teclado volta ao começo da página. A cópia já seleciona o nome para renomear direto.
  useEffect(() => {
    const campo = document.getElementById("ft-nome") as HTMLInputElement | null;
    campo?.focus();
    if (modo === "copia") campo?.select();
  }, [modo]);

  // Ingrediente recém-adicionado: o cursor vai direto para a quantidade.
  useEffect(() => {
    if (!focoNaLinha) return;
    const campo = document.getElementById(`ft-qtd-${focoNaLinha}`) as HTMLInputElement | null;
    campo?.focus();
    campo?.select();
    setFocoNaLinha(null);
  }, [focoNaLinha, itens]);

  // Depois da primeira tentativa de salvar, os erros acompanham a digitação.
  const errosVisiveis = useMemo(() => (erros ? validarFicha(campos, itens) : null), [erros, campos, itens]);
  const resumo = useMemo(() => resumoDaFicha(campos, itens), [campos, itens]);
  const faixa = faixaDeCmv(resumo.cmvPercentual);

  const idsNaFicha = useMemo(() => new Set(itens.map((item) => item.productId)), [itens]);
  const repetidos = useMemo(() => {
    const contagem = new Map<string, number>();
    itens.forEach((item) => contagem.set(item.productId, (contagem.get(item.productId) ?? 0) + 1));
    return contagem;
  }, [itens]);

  // Preços já praticados nos canais: um toque preenche o preço padrão.
  const atalhosDePreco = useMemo(() => {
    if (modo !== "editar" || !base) return [];
    const vistos = new Set<number>();
    return base.listings
      .filter((listagem) => listagem.isActive)
      .filter((listagem) => !vistos.has(listagem.price) && vistos.add(listagem.price))
      .slice(0, MAXIMO_DE_ATALHOS_DE_PRECO);
  }, [modo, base]);

  const opcoesDeCategoria = categorias
    .filter((categoria) => categoria.isActive || categoria.id === campos.categoryId)
    .map((categoria) => ({ value: categoria.id, label: categoria.isActive ? categoria.name : `${categoria.name} (inativa)` }));

  function alterarCampo(campo: keyof CamposDaFicha, valor: string) {
    setCampos((anterior) => ({ ...anterior, [campo]: valor }));
  }

  function adicionarProduto(produto: DishProductSearchResult) {
    const tempId = novoIdDeLinha();
    setItens((anterior) => [
      ...anterior,
      {
        tempId,
        productId: produto.id,
        productName: produto.name,
        quantity: "",
        unit: normalizarUnidade(produto.unit) || "UN",
        wasteFactor: "0",
        unitCost: produto.averageCost,
        productUnit: produto.unit,
        conversions: produto.conversions ?? [],
        notes: ""
      }
    ]);
    setFocoNaLinha(tempId);
  }

  function alterarItem(tempId: string, campo: "quantity" | "unit" | "wasteFactor", valor: string) {
    setItens((anterior) => anterior.map((item) => (item.tempId === tempId ? { ...item, [campo]: valor } : item)));
  }

  function removerItem(tempId: string) {
    setItens((anterior) => anterior.filter((item) => item.tempId !== tempId));
  }

  function focarPrimeiroErro(encontrados: ErrosDaFicha) {
    const [idDoItem, erroDoItem] = Object.entries(encontrados.itens)[0] ?? [];
    const alvo = encontrados.name
      ? "ft-nome"
      : encontrados.salePriceDefault
        ? "ft-preco"
        : encontrados.yieldQty
          ? "ft-rendimento"
          : `${erroDoItem?.campo === "wasteFactor" ? "ft-perda" : "ft-qtd"}-${idDoItem}`;
    // O erro só aparece depois do render seguinte.
    window.setTimeout(() => document.getElementById(alvo)?.focus(), 0);
  }

  async function salvar() {
    const encontrados = validarFicha(campos, itens);
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
        })
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
    if (evento.target.closest(".ft-ingrediente")) document.getElementById("ft-busca-ingrediente")?.focus();
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
          <FormField label="Categoria">
            <Select
              value={campos.categoryId}
              onChange={(evento) => alterarCampo("categoryId", evento.target.value)}
              options={opcoesDeCategoria}
              placeholder="Sem categoria"
            />
          </FormField>
          <FormField
            label="Preço de venda (R$)"
            hint="Por porção. Em branco, a ficha não calcula margem nem CMV."
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

      <section className="ft-secao" aria-labelledby="ft-ingredientes-form">
        <h3 id="ft-ingredientes-form" className="ft-secao-titulo">
          Ingredientes <span className="ft-secao-n">{itens.length}</span>
        </h3>

        <BuscaDeIngrediente jaNaFicha={idsNaFicha} onEscolher={adicionarProduto} />

        {itens.length === 0 ? (
          <p className="ft-vazio-ingredientes">
            Nenhum ingrediente ainda. Busque o produto acima, informe a quantidade e a unidade em que ele entra na receita.
          </p>
        ) : (
          <>
            <div className="ft-ingredientes-cabecalho" aria-hidden>
              <span>Ingrediente</span><span>Quantidade</span><span>Unidade</span><span>Perda %</span><span>Custo</span><span />
            </div>
            <ul className="ft-ingredientes-lista">
              {itens.map((item) => (
                <LinhaDeIngrediente
                  key={item.tempId}
                  item={item}
                  erro={mostrarErros.itens[item.tempId]}
                  repetido={(repetidos.get(item.productId) ?? 0) > 1}
                  onAlterar={alterarItem}
                  onRemover={removerItem}
                />
              ))}
            </ul>
          </>
        )}
      </section>

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
