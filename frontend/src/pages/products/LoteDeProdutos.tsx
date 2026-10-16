import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  obterPanoramaDoLote,
  organizarProdutosEmLote,
  type AlvoDoLote,
  type Category,
  type InventorySector,
  type NatureOption,
  type PanoramaDoLote,
  type ResumoDoLote,
  type Subcategory
} from "../../api/client";
import {
  LIMPAR,
  LOTE_VAZIO,
  MANTER,
  comCategoria,
  descricaoDasMudancas,
  mudancasDoFormulario,
  temMudanca,
  type FormularioDoLote
} from "./lote";

type Props = {
  alvo: AlvoDoLote;
  quantidade: number;
  /** Categoria do filtro atual: deixa escolher a subcategoria sem trocar a categoria. */
  categoriaDoFiltroId?: string;
  categories: Category[];
  subcategories: Subcategory[];
  sectors: InventorySector[];
  natures: NatureOption[];
  onAplicado: (resumo: ResumoDoLote) => void;
  onFechar: () => void;
};

/** "Hoje: ESTOQUE (30), BAR (15)" — ou "todos" quando não há variação. */
export function textoDeHoje(itens: Array<{ rotulo: string; count: number }> | undefined): string | null {
  if (!itens || itens.length === 0) return null;
  if (itens.length === 1) return `Hoje: ${itens[0].rotulo} (todos)`;
  return `Hoje: ${itens.map((item) => `${item.rotulo} (${item.count})`).join(", ")}`;
}

type CampoProps = {
  titulo: string;
  ajuda: ReactNode;
  hoje: string | null;
  mudou: boolean;
  children: (ids: { id: string; descricao: string }) => ReactNode;
};

function Campo({ titulo, ajuda, hoje, mudou, children }: CampoProps) {
  const id = useId();
  const descricao = `${id}-ajuda`;
  return (
    <div className={`lote-campo${mudou ? " lote-campo-mudou" : ""}`}>
      <label htmlFor={id}>{titulo}</label>
      <p id={descricao} className="lote-campo-ajuda">{ajuda}</p>
      {hoje && <p className="lote-hoje">{hoje}</p>}
      {children({ id, descricao })}
      {mudou && <span className="lote-vai-mudar">vai mudar</span>}
    </div>
  );
}

export function LoteDeProdutos({ alvo, quantidade, categoriaDoFiltroId, categories, subcategories, sectors, natures, onAplicado, onFechar }: Props) {
  const [form, setForm] = useState<FormularioDoLote>(LOTE_VAZIO);
  const [resumo, setResumo] = useState<ResumoDoLote | null>(null);
  const [panorama, setPanorama] = useState<PanoramaDoLote | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const tituloDoResumo = useRef<HTMLHeadingElement>(null);
  // O resumo e o "hoje" são de um alvo: se a seleção mudou, não valem mais e não podem ser aplicados.
  const chaveDoAlvo = JSON.stringify(alvo);
  useEffect(() => {
    setResumo(null);
    setPanorama(null);
    let ativo = true;
    obterPanoramaDoLote(alvo)
      .then((retorno) => { if (ativo) setPanorama(retorno); })
      .catch(() => { /* sem o "hoje" o painel continua servindo: só perde a referência */ });
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDoAlvo]);
  // O botão "Conferir" some quando o resumo aparece: leva o foco para o resumo para não se perder.
  useEffect(() => {
    if (resumo) tituloDoResumo.current?.focus();
  }, [resumo]);

  const categoriasAtivas = useMemo(() => categories.filter((c) => c.isActive !== false), [categories]);
  const categoriaEfetiva = form.categoryId || categoriaDoFiltroId || "";
  const subcategoriasDaCategoria = useMemo(
    () => subcategories.filter((s) => s.categoryId === categoriaEfetiva && s.isActive !== false),
    [subcategories, categoriaEfetiva]
  );
  const naturezaEscolhida = natures.find((n) => n.value === form.nature);

  const nomes = {
    categoria: categories.find((c) => c.id === form.categoryId)?.name,
    subcategoria: subcategories.find((s) => s.id === form.subcategoryId)?.name,
    setor: sectors.find((s) => s.id === form.inventorySectorId)?.name,
    natureza: naturezaEscolhida?.label
  };
  const escolhas = descricaoDasMudancas(form, nomes);

  function mudar(parcial: Partial<FormularioDoLote>) {
    setForm((atual) => ({ ...atual, ...parcial }));
    setResumo(null);
    setErro(null);
  }

  async function executar(aplicar: boolean) {
    setCarregando(true);
    setErro(null);
    try {
      const retorno = await organizarProdutosEmLote(alvo, mudancasDoFormulario(form), aplicar, aplicar ? resumo?.alterar : undefined);
      if (aplicar) onAplicado(retorno);
      else setResumo(retorno);
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível organizar os produtos.");
    } finally {
      setCarregando(false);
    }
  }

  const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

  return (
    <section className="lote-painel" aria-label="Organizar produtos selecionados">
      <div className="lote-cabecalho">
        <div>
          <h3>Organizar {quantidade} {plural(quantidade, "produto", "produtos")}</h3>
          <ol className="lote-passos" aria-label="Etapas">
            <li aria-current={resumo ? undefined : "step"} className={resumo ? "" : "lote-passo-atual"}>1. Escolha o que mudar</li>
            <li aria-current={resumo ? "step" : undefined} className={resumo ? "lote-passo-atual" : ""}>2. Confira</li>
            <li>3. Aplique</li>
          </ol>
        </div>
        <button type="button" className="secondary-button" onClick={onFechar} disabled={carregando}>Fechar sem mudar nada</button>
      </div>

      {!resumo && (
        <>
          <p className="lote-dica">
            <strong>Nada muda agora.</strong> Escolha só o que quer mudar; o que você não mexer fica como está. Em seguida você confere e só então aplica.
          </p>

          <div className="lote-campos">
            <Campo titulo="Categoria" ajuda="Em qual grupo de produtos o item entra." hoje={textoDeHoje(panorama?.categoria)} mudou={form.categoryId !== MANTER}>
              {({ id, descricao }) => (
                <select id={id} aria-describedby={descricao} value={form.categoryId} onChange={(e) => { setForm(comCategoria(form, e.target.value)); setResumo(null); setErro(null); }}>
                  <option value={MANTER}>Não mudar</option>
                  {categoriasAtivas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              )}
            </Campo>

            <Campo
              titulo="Subcategoria"
              ajuda={
                categoriaEfetiva
                  ? form.categoryId && form.subcategoryId === MANTER
                    ? "Ao trocar a categoria, a subcategoria atual é apagada (ela era da categoria antiga). Escolha uma nova se quiser."
                    : "Divisão dentro da categoria, como Arroz ou Feijão."
                  : "Escolha uma categoria acima, ou filtre a lista por uma categoria, para ver as subcategorias."
              }
              hoje={textoDeHoje(panorama?.subcategoria)}
              mudou={form.subcategoryId !== MANTER}
            >
              {({ id, descricao }) => (
                <select id={id} aria-describedby={descricao} value={form.subcategoryId} onChange={(e) => mudar({ subcategoryId: e.target.value })} disabled={!categoriaEfetiva && form.subcategoryId !== LIMPAR}>
                  <option value={MANTER}>Não mudar</option>
                  <option value={LIMPAR}>Deixar sem subcategoria</option>
                  {subcategoriasDaCategoria.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </Campo>

            <Campo titulo="Setor de contagem" ajuda="Onde o item fica guardado e é contado no estoque." hoje={textoDeHoje(panorama?.setor)} mudou={form.inventorySectorId !== MANTER}>
              {({ id, descricao }) => (
                <select id={id} aria-describedby={descricao} value={form.inventorySectorId} onChange={(e) => mudar({ inventorySectorId: e.target.value })}>
                  <option value={MANTER}>Não mudar</option>
                  <option value={LIMPAR}>Deixar sem setor</option>
                  {sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </Campo>

            <Campo
              titulo="Natureza"
              ajuda={naturezaEscolhida ? naturezaEscolhida.description : "O que o item é: mercadoria, embalagem, material de consumo, utensílio ou serviço."}
              hoje={textoDeHoje(panorama?.natureza)}
              mudou={form.nature !== MANTER}
            >
              {({ id, descricao }) => (
                <select id={id} aria-describedby={descricao} value={form.nature} onChange={(e) => mudar({ nature: e.target.value })}>
                  <option value={MANTER}>Não mudar</option>
                  {natures.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                </select>
              )}
            </Campo>

            <Campo
              titulo="Entra na contagem de estoque?"
              ajuda="Se sim, o item aparece na contagem e o fechamento do mês passa a exigir que ele seja contado."
              hoje={textoDeHoje(panorama?.estoque)}
              mudou={form.controlsStock !== ""}
            >
              {({ id, descricao }) => (
                <select id={id} aria-describedby={descricao} value={form.controlsStock} onChange={(e) => mudar({ controlsStock: e.target.value as FormularioDoLote["controlsStock"] })}>
                  <option value="">Não mudar</option>
                  <option value="sim">Sim, entra na contagem</option>
                  <option value="nao">Não, fica fora da contagem</option>
                </select>
              )}
            </Campo>

            <Campo titulo="Situação" ajuda="Produto inativo some das listas e das compras novas; o histórico continua." hoje={textoDeHoje(panorama?.situacao)} mudou={form.isActive !== ""}>
              {({ id, descricao }) => (
                <select id={id} aria-describedby={descricao} value={form.isActive} onChange={(e) => mudar({ isActive: e.target.value as FormularioDoLote["isActive"] })}>
                  <option value="">Não mudar</option>
                  <option value="ativar">Ativar</option>
                  <option value="inativar">Inativar</option>
                </select>
              )}
            </Campo>
          </div>

          {escolhas.length > 0 && (
            <div className="lote-escolhas" aria-label="O que você escolheu">
              <strong>Você escolheu:</strong>
              <ul>{escolhas.map((linha) => <li key={linha}>{linha}</li>)}</ul>
            </div>
          )}

          {erro && <div className="alert error" role="alert">{erro}</div>}

          <div className="lote-acoes">
            <button type="button" className="primary-button" disabled={!temMudanca(form) || carregando} onClick={() => void executar(false)}>
              {carregando ? "Conferindo..." : "Conferir antes de aplicar"}
            </button>
            {!temMudanca(form) && <span className="lote-dica">Escolha ao menos uma mudança para conferir.</span>}
          </div>
        </>
      )}

      {resumo && (
        <div className="lote-resumo" role="region" aria-label="Resumo do que vai mudar" aria-live="polite">
          <h4 ref={tituloDoResumo} tabIndex={-1} className="lote-resumo-titulo">
            {resumo.alterar === 0
              ? "Nenhum produto vai mudar"
              : `${resumo.alterar} ${plural(resumo.alterar, "produto vai mudar", "produtos vão mudar")}`}
          </h4>
          <p className="lote-resumo-linha">
            {resumo.semMudanca > 0 && <>{resumo.semMudanca} {plural(resumo.semMudanca, "já está", "já estão")} assim, não precisa mudar. </>}
            {resumo.recusados > 0 && <><strong>{resumo.recusados} {plural(resumo.recusados, "não pode mudar", "não podem mudar")}</strong> (veja abaixo). </>}
            Os demais ficam exatamente como estão.
          </p>

          <ul className="lote-mudancas" aria-label="O que você escolheu">
            {escolhas.map((linha) => <li key={linha}>{linha}</li>)}
          </ul>

          {resumo.amostra.length > 0 && (
            <div className="lote-amostra-bloco">
              <strong>Veja como fica {resumo.alterar > resumo.amostra.length ? `(primeiros ${resumo.amostra.length} de ${resumo.alterar})` : ""}:</strong>
              <ul className="lote-amostra-lista">
                {resumo.amostra.map((item) => (
                  <li key={item.nome}>
                    <span className="lote-amostra-nome">{item.nome}</span>
                    <ul>{item.linhas.map((linha) => <li key={linha}>{linha}</li>)}</ul>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resumo.recusadosPorMotivo.length > 0 && (
            <div className="lote-recusas" aria-label="Produtos que não vão mudar">
              <strong>Estes não vão mudar. Continuam como estão, nada é gravado neles:</strong>
              <ul>
                {resumo.recusadosPorMotivo.map((grupo) => (
                  <li key={grupo.motivo}>
                    <strong>{grupo.count}</strong> {plural(grupo.count, "produto", "produtos")}: {grupo.motivo}{" "}
                    <span className="lote-amostra">(por exemplo: {grupo.exemplos.join(", ")}{grupo.count > grupo.exemplos.length ? "…" : ""})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {resumo.avisos.length > 0 && (
            <div className="lote-avisos" aria-label="Avisos">
              <strong>Bom saber:</strong>
              <ul>{resumo.avisos.map((aviso) => <li key={aviso}>{aviso}</li>)}</ul>
            </div>
          )}

          {erro && <div className="alert error" role="alert">{erro}</div>}

          <div className="lote-acoes">
            <button type="button" className="primary-button" disabled={resumo.alterar === 0 || carregando} onClick={() => void executar(true)}>
              {carregando ? "Aplicando..." : `Aplicar em ${resumo.alterar} ${plural(resumo.alterar, "produto", "produtos")}`}
            </button>
            <button type="button" className="secondary-button" disabled={carregando} onClick={() => setResumo(null)}>Voltar e ajustar</button>
          </div>
          <p className="lote-dica">Depois de aplicar você poderá <strong>desfazer tudo</strong>. O desfazer devolve só os produtos que ninguém editou depois.</p>
        </div>
      )}
    </section>
  );
}
