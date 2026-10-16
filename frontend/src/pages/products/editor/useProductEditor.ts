import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addProductAlias,
  ApiError,
  getProductById,
  getProductFormOptions,
  getSimilarProducts,
  saveCategory,
  saveProduct,
  saveSubcategory,
  type ProductFormOptions,
  type SimilarProduct
} from "../../../api/client";
import {
  avisosDaNatureza,
  cadastroRigido,
  dreDaCategoria,
  passosVisiveis,
  pendenciasDoCadastro,
  type StepId
} from "../natureza";
import {
  aplicarNatureza,
  emptyProductForm,
  formToPayload,
  normalizeForm,
  productToForm,
  setorDisponivel,
  type ProductFormState
} from "../productForm";

const OPCOES_VAZIAS: ProductFormOptions = {
  categories: [], subcategories: [], sectors: [], units: [], suppliers: [], dreCategories: [], natures: [], nextCode: ""
};
const MIN_LETRAS_PARA_SIMILAR = 3;
const ESPERA_SIMILAR_MS = 400;

export type ResultadoDoSalvar = { ok: true; mensagem: string; tom: "success" | "warning" } | { ok: false };

export function useProductEditor(productId: string | undefined) {
  const cadastroNovo = !productId;
  const [opcoes, setOpcoes] = useState<ProductFormOptions>(OPCOES_VAZIAS);
  const [form, setFormEstado] = useState<ProductFormState>(emptyProductForm);
  const [alias, setAlias] = useState("");
  const [rascunhoOrigem, setRascunhoOrigem] = useState("");
  const [rascunhoFator, setRascunhoFator] = useState("");
  const [conversoesCarregadas, setConversoesCarregadas] = useState<Array<{ fromUnit: string; toUnit: string }>>([]);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [passo, setPasso] = useState<StepId>("natureza");
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [similares, setSimilares] = useState<SimilarProduct[]>([]);

  const natures = opcoes.natures ?? [];
  const opcaoDaNatureza = natures.find((item) => item.value === form.nature) ?? null;
  const setores = useMemo(() => setorDisponivel(opcoes.sectors), [opcoes.sectors]);

  const carregarOpcoes = useCallback(async () => {
    const dados = await getProductFormOptions();
    setOpcoes({
      ...OPCOES_VAZIAS,
      ...dados,
      categories: Array.isArray(dados.categories) ? dados.categories : [],
      subcategories: Array.isArray(dados.subcategories) ? dados.subcategories : [],
      sectors: Array.isArray(dados.sectors) ? dados.sectors.filter((s) => s.isActive !== false) : [],
      units: Array.isArray(dados.units) ? dados.units.filter((u) => u.isActive) : [],
      suppliers: Array.isArray(dados.suppliers) ? dados.suppliers.filter((s) => s.isActive) : [],
      dreCategories: Array.isArray(dados.dreCategories) ? dados.dreCategories : []
    });
    return dados;
  }, []);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    setErro(null);
    (async () => {
      try {
        const dados = await carregarOpcoes();
        const unidades = (dados.units ?? []).filter((u) => u.isActive);
        const inicial = productId
          ? productToForm(await getProductById(productId), unidades)
          : { ...emptyProductForm, externalCode: dados.nextCode ?? "" };
        if (cancelado) return;
        setFormEstado(inicial);
        setConversoesCarregadas(inicial.unitConversions.map(({ fromUnit, toUnit }) => ({ fromUnit, toUnit })));
        setSnapshot(normalizeForm(inicial, ""));
        // Produto antigo abre na identificação: escolher a natureza é opcional para ele.
        setPasso(productId ? "identificacao" : "natureza");
      } catch (falha) {
        if (!cancelado) {
          setErro(falha instanceof Error ? falha.message : "Não foi possível abrir o cadastro do produto.");
        }
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();
    return () => { cancelado = true; };
  }, [productId, carregarOpcoes]);

  const setForm = useCallback((alterar: (atual: ProductFormState) => ProductFormState) => {
    setFormEstado(alterar);
  }, []);

  const sujo = snapshot !== null && normalizeForm(form, alias) !== snapshot;

  // Nome parecido: só vale em cadastro novo, depois que a pessoa parou de digitar.
  const consultaSimilar = useRef(0);
  useEffect(() => {
    const nome = form.name.trim();
    // Toda saída do efeito invalida a consulta em andamento: resposta atrasada não repõe a lista.
    const minha = ++consultaSimilar.current;
    if (!cadastroNovo || nome.length < MIN_LETRAS_PARA_SIMILAR) {
      setSimilares([]);
      return () => { consultaSimilar.current++; };
    }
    const timer = window.setTimeout(() => {
      getSimilarProducts(nome)
        .then((resposta) => { if (minha === consultaSimilar.current) setSimilares(resposta.items); })
        .catch(() => { if (minha === consultaSimilar.current) setSimilares([]); });
    }, ESPERA_SIMILAR_MS);
    return () => {
      window.clearTimeout(timer);
      consultaSimilar.current++;
    };
  }, [form.name, cadastroNovo]);

  const escolherNatureza = useCallback((valor: ProductFormState["nature"]) => {
    const opcao = natures.find((item) => item.value === valor);
    if (!opcao) return;
    // Clicar de novo na natureza já escolhida não pode desfazer o que a pessoa ajustou depois.
    setFormEstado((atual) => (atual.nature === valor ? atual : aplicarNatureza(atual, opcao, opcoes.dreCategories)));
  }, [natures, opcoes.dreCategories]);

  /** Categoria escolhida pode sugerir a categoria DRE usual, se ainda não houver uma. */
  const escolherCategoria = useCallback((categoryId: string) => {
    setFormEstado((atual) => {
      // Subcategoria começa vazia: escolher a primeira da lista em silêncio gravaria classificação errada.
      const proximo = { ...atual, categoryId, subcategoryId: "" };
      if (atual.dreCategoryId) return proximo;
      const nome = opcoes.categories.find((c) => c.id === categoryId)?.name;
      const sugerida = dreDaCategoria(nome, opcaoDaNatureza, opcoes.dreCategories);
      return sugerida ? { ...proximo, dreCategoryId: sugerida.id } : proximo;
    });
  }, [opcoes.categories, opcoes.subcategories, opcoes.dreCategories, opcaoDaNatureza]);

  const grupoDre = opcoes.dreCategories.find((c) => c.id === form.dreCategoryId)?.dreGroup ?? null;
  const passos = passosVisiveis(opcaoDaNatureza, cadastroNovo);
  const pendencias = pendenciasDoCadastro(form, opcaoDaNatureza, cadastroNovo);
  const avisos = avisosDaNatureza(opcaoDaNatureza, grupoDre, form.controlsStock);
  const rigido = cadastroRigido(opcaoDaNatureza, cadastroNovo);
  // Falha ao abrir um produto existente: sem o cadastro carregado não há o que salvar.
  const falhaDeCarga = !carregando && erro !== null && snapshot === null;
  const podeSalvar = !carregando && !salvando && !falhaDeCarga && (rigido ? pendencias.length === 0 : form.name.trim() !== "");

  const criarCategoria = useCallback(async (nome: string) => {
    const criada = await saveCategory({ name: nome, isActive: true });
    await carregarOpcoes();
    setFormEstado((atual) => ({ ...atual, categoryId: criada.id, subcategoryId: "" }));
  }, [carregarOpcoes]);

  const criarSubcategoria = useCallback(async (nome: string) => {
    if (!form.categoryId) return;
    const criada = await saveSubcategory({ name: nome, categoryId: form.categoryId, isActive: true });
    await carregarOpcoes();
    setFormEstado((atual) => ({ ...atual, subcategoryId: criada.id }));
  }, [form.categoryId, carregarOpcoes]);

  async function salvar(): Promise<ResultadoDoSalvar> {
    if (!podeSalvar) return { ok: false };
    setSalvando(true);
    setErro(null);
    try {
      const categoria = opcoes.categories.find((item) => item.id === form.categoryId)?.name;
      const subcategoria = opcoes.subcategories.find((item) => item.id === form.subcategoryId)?.name;
      const corpo = formToPayload(form, { categoria, subcategoria }, conversoesCarregadas);
      let salvo;
      try {
        salvo = await saveProduct(corpo);
      } catch (falha) {
        // Trocar a unidade de contagem de produto com histórico não converte saldo, custo nem
        // contagens: o servidor pede confirmação explícita.
        if (!(falha instanceof ApiError && falha.status === 409 && falha.body?.code === "TROCA_DA_UNIDADE_DE_CONTAGEM")) throw falha;
        if (!window.confirm(falha.message)) return { ok: false };
        salvo = await saveProduct({ ...corpo, confirmarTrocaDaUnidadeDeContagem: true });
      }
      const atualizacao = Boolean(form.id);
      // O apelido é gravado depois do produto: se conflitar, o cadastro já está salvo.
      if (alias.trim()) {
        try {
          await addProductAlias(salvo.id, alias);
        } catch (falha) {
          const motivo = falha instanceof Error ? falha.message : "Não foi possível gravar o apelido.";
          return {
            ok: true,
            tom: "warning",
            mensagem: `${atualizacao ? "Cadastro atualizado" : "Cadastro criado"}, mas o apelido não foi gravado: ${motivo}`
          };
        }
      }
      return { ok: true, tom: "success", mensagem: atualizacao ? "Cadastro atualizado com sucesso." : "Cadastro criado com sucesso." };
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Erro ao salvar produto.");
      return { ok: false };
    } finally {
      setSalvando(false);
    }
  }

  return {
    cadastroNovo, carregando, salvando, erro, setErro, falhaDeCarga,
    opcoes, setores, natures, opcaoDaNatureza,
    form, setForm, alias, setAlias,
    rascunhoOrigem, setRascunhoOrigem, rascunhoFator, setRascunhoFator,
    passo, setPasso, passos, pendencias, avisos, rigido, podeSalvar,
    similares, sujo,
    escolherNatureza, escolherCategoria, criarCategoria, criarSubcategoria, salvar
  };
}
