import { Check, CheckCircle2, FileText, Loader2, Plus, ScanLine, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createPurchase, type Company, type DocIntakeProdutoSugerido, type DocIntakeSugestaoLinha, type DocIntakeTitulo, type PaymentMethod, type Product, type Supplier } from "../api/client";
import { Button, FormGrid, Select, StatusBadge, TextField } from "../design-system";
import { AvisosDoTitulo } from "./AvisosDoTitulo";
import { ParcelasEditor, type LinhaParcela } from "./ParcelasEditor";
import { SeletorProduto } from "./SeletorProduto";
import { VisualizadorDocumento, type DocumentoVisivel } from "./VisualizadorDocumento";
import { numeroBr } from "../utils/format";

import "./DocIntake.css";

type Props = {
  titulo: DocIntakeTitulo;
  /** Os arquivos deste titulo, para ficarem a vista durante a conferencia. */
  arquivos: DocumentoVisivel[];
  fornecedores: Supplier[];
  empresas: Company[];
  formasPagamento: PaymentMethod[];
  onLancado: (mensagem: string) => void;
  onErro: (mensagem: string) => void;
};

/** Uma linha de item — espelha a grade da tela de Compras. */
type LinhaItem = {
  /** Descricao como veio no documento; fica visivel para orientar a escolha do produto. */
  descricaoLida: string;
  produto: Product | null;
  quantidade: string;
  precoUnitario: string;
};

const TOLERANCIA_CENTAVOS = 0.01;
/** Prefixo gravado em Purchase.sourceFile. Espelha ORIGEM_LEITURA do backend. */
const ORIGEM_LEITURA = "doc-intake:";

function paraInputDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Campo de dinheiro/quantidade → número. Aceita "1.234,56" e "1234.56". */
const numero = numeroBr;

function dinheiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * A sugestão vem no formato do módulo de leitura; o seletor trabalha com o
 * Product do cadastro. Só os campos que a tela usa são preenchidos — o resto
 * chega quando a pessoa busca o produto.
 */
export function sugeridoParaProduto(sugerido: DocIntakeProdutoSugerido): Product {
  return {
    id: sugerido.id,
    name: sugerido.nome,
    unit: sugerido.unidade,
    externalCode: sugerido.codigoExterno,
    category: sugerido.categoria ? { name: sugerido.categoria } : null,
    subcategory: sugerido.subcategoria ? { name: sugerido.subcategoria } : null,
  } as unknown as Product;
}

/**
 * A oferta que aparece no seletor. Sugestão de confiança ALTA não entra aqui:
 * ela já foi aplicada na linha, e repetir a oferta só confundiria.
 */
function sugestaoOferecida(sugestao: DocIntakeSugestaoLinha | undefined) {
  if (!sugestao?.sugestao || sugestao.confianca === "ALTA" || !sugestao.motivo) return null;
  return { produto: sugeridoParaProduto(sugestao.sugestao), motivo: sugestao.motivo };
}

/**
 * Um titulo conferivel. Os campos vem preenchidos pela leitura e sao todos
 * editaveis: o modelo propoe, a pessoa decide. Nada e gravado ate o clique.
 *
 * Os itens seguem o mesmo desenho do lancamento de compra: escolhe-se o PRODUTO,
 * e categoria/subcategoria vem dele — nunca sao digitadas. Cada linha lida do
 * documento vira uma linha aqui, para o total dos itens bater com o da nota
 * (o backend recusa a compra se divergir).
 */
export function DocIntakeTituloCard({ titulo, arquivos, fornecedores, empresas, formasPagamento, onLancado, onErro }: Props) {
  const [supplierId, setSupplierId] = useState(titulo.fornecedor.cadastrado ? titulo.fornecedor.id : "");
  const [companyId, setCompanyId] = useState(titulo.empresa?.id ?? "");
  const [numeroNota, setNumeroNota] = useState(titulo.numeroDocumento ?? "");
  const [emissao, setEmissao] = useState(paraInputDate(titulo.dataEmissao) || paraInputDate(titulo.dataVencimento));
  const [paymentMethodId, setPaymentMethodId] = useState("");

  // Uma linha por boleto lido. Sem boleto, o backend ja devolve uma parcela
  // unica com os dados da propria nota.
  const [parcelas, setParcelas] = useState<LinhaParcela[]>(() =>
    titulo.parcelas.map((parcela) => ({
      dataVencimento: paraInputDate(parcela.dataVencimento),
      valor: parcela.valor != null ? String(parcela.valor) : "",
      origem: parcela.origem,
    })),
  );
  const [lancando, setLancando] = useState(false);
  const [lancado, setLancado] = useState<string | null>(null);

  // Uma linha por rubrica lida. Documento sem discriminacao (boleto avulso)
  // comeca com uma linha unica, ja com o valor cheio.
  const [linhas, setLinhas] = useState<LinhaItem[]>(() => {
    const rubricas = titulo.rubricas.filter((rubrica) => rubrica.valor != null && rubrica.valor > 0);
    if (rubricas.length > 0) {
      return rubricas.map((rubrica, indice) => {
        const sugestao = titulo.sugestoesItens?.[indice];
        return {
          descricaoLida: rubrica.descricao,
          // So confianca ALTA entra ja preenchida — quando o sistema tem prova
          // (mesmo fornecedor, mesmo nome, apelido cadastrado). Palpite por
          // semelhanca fica apenas oferecido: aceitar sem olhar seria trocar
          // trabalho por erro silencioso no CMV.
          produto: sugestao?.confianca === "ALTA" && sugestao.sugestao
            ? sugeridoParaProduto(sugestao.sugestao)
            : null,
          quantidade: "1",
          precoUnitario: String(rubrica.valor ?? ""),
        };
      });
    }
    return [{ descricaoLida: "", produto: null, quantidade: "1", precoUnitario: String(titulo.valorTotal ?? "") }];
  });

  const bloqueios = titulo.avisos.filter((aviso) => aviso.nivel === "BLOQUEIO");
  const atencoes = titulo.avisos.filter((aviso) => aviso.nivel === "ATENCAO");

  const totalItens = useMemo(
    () => linhas.reduce((soma, linha) => soma + numero(linha.quantidade) * numero(linha.precoUnitario), 0),
    [linhas],
  );
  const valorDocumento = titulo.valorTotal ?? 0;
  const diferenca = totalItens - valorDocumento;
  const totalBate = Math.abs(diferenca) <= TOLERANCIA_CENTAVOS;

  function alterarLinha(indice: number, mudanca: Partial<LinhaItem>) {
    setLinhas((atual) => atual.map((linha, i) => (i === indice ? { ...linha, ...mudanca } : linha)));
  }

  const faltando = useMemo(() => {
    const itens: string[] = [];
    if (!supplierId) itens.push("fornecedor");
    if (!companyId) itens.push("empresa");
    if (!numeroNota.trim()) itens.push("número da nota");
    if (!emissao) itens.push("data de emissão");
    if (!paymentMethodId) itens.push("forma de pagamento");
    if (linhas.some((linha) => !linha.produto)) itens.push("produto de cada linha");
    if (linhas.some((linha) => numero(linha.quantidade) <= 0)) itens.push("quantidade maior que zero");
    if (parcelas.some((parcela) => !parcela.dataVencimento)) itens.push("vencimento de cada parcela");
    return itens;
  }, [supplierId, companyId, numeroNota, emissao, paymentMethodId, linhas, parcelas]);

  const somaParcelas = useMemo(
    () => parcelas.reduce((soma, parcela) => soma + numero(parcela.valor), 0),
    [parcelas],
  );
  // O backend recusa a compra se as parcelas nao fecharem com o total: melhor a
  // pessoa ver a trava aqui do que receber o erro depois de preencher tudo.
  const parcelasFecham = Math.abs(somaParcelas - totalItens) <= TOLERANCIA_CENTAVOS;

  const podeLancar = bloqueios.length === 0 && faltando.length === 0 && totalBate && parcelasFecham && !lancando && !lancado;

  async function lancar() {
    const descricaoParcelas = parcelas.length === 1
      ? `vencendo em ${parcelas[0].dataVencimento.split("-").reverse().join("/")}`
      : `em ${parcelas.length} parcelas (primeira em ${parcelas[0].dataVencimento.split("-").reverse().join("/")})`;
    const confirma = window.confirm(
      `Lançar ${dinheiro(totalItens)} para ${fornecedores.find((f) => f.id === supplierId)?.name ?? "o fornecedor"}, ${descricaoParcelas}?`,
    );
    if (!confirma) return;

    setLancando(true);
    try {
      const criada = await createPurchase({
        supplierId,
        companyId,
        purchaseDate: emissao,
        invoiceNumber: numeroNota.trim(),
        totalAmount: totalItens,
        paymentMethodId,
        // Marca de origem consultável. Diferente das observações (texto livre),
        // este campo permite listar — e reverter em bloco, se precisar — tudo
        // que foi lançado pela leitura de documentos.
        sourceFile: `${ORIGEM_LEITURA}${titulo.documentos.join("+")}`,
        notes: `Lançado pela leitura de documentos a partir de: ${titulo.documentos.join(", ")}`,
        items: linhas.map((linha) => {
          const quantidade = numero(linha.quantidade);
          const precoUnitario = numero(linha.precoUnitario);
          return {
            productId: linha.produto!.id,
            rawProductCode: linha.produto!.externalCode ?? null,
            rawProductName: linha.produto!.name,
            unit: linha.produto!.unit ?? "UN",
            unitMeasureId: linha.produto!.unitMeasureId ?? null,
            quantity: quantidade,
            unitPrice: precoUnitario,
            totalPrice: Number((quantidade * precoUnitario).toFixed(2)),
            // Categoria e subcategoria vem do produto, como na tela de Compras.
            rawCategory: linha.produto!.category?.name ?? null,
            rawSubcategory: linha.produto!.subcategory?.name ?? null,
          };
        }),
        installments: parcelas.map((parcela, indice) => ({
          installment: indice + 1,
          dueDate: parcela.dataVencimento,
          amount: numero(parcela.valor),
          paymentMethodId,
        })),
      });
      setLancado(criada.purchaseNumber || criada.id);
      onLancado(`Compra ${criada.purchaseNumber ?? ""} lançada. Já está no Contas a Pagar.`);
    } catch (erro) {
      onErro((erro as Error).message);
    } finally {
      setLancando(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
      <div className="doc-conferencia">
        {/* O documento fica do lado esquerdo, fixo na rolagem: a conferencia e
            comparar o que esta na tela com o que esta no papel. */}
        <div className="doc-conferencia__documento">
          <VisualizadorDocumento documentos={arquivos} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <StatusBadge tone={bloqueios.length > 0 ? "danger" : "success"}>{titulo.tipoPrincipal}</StatusBadge>
        {titulo.documentos.length > 1 && (
          <StatusBadge tone="info"><FileText size={12} /> {titulo.documentos.length} arquivos = 1 título</StatusBadge>
        )}
        {titulo.lidoPorImagem && <StatusBadge tone="warning"><ScanLine size={12} /> lido da imagem</StatusBadge>}
      </div>

      {/* O valor e o primeiro numero que se confere: ganha o peso visual. */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="doc-valor-destaque">{dinheiro(valorDocumento)}</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>
          lido no documento{titulo.numeroDocumento ? ` · nº ${titulo.numeroDocumento}` : ""}
        </span>
      </div>

      <AvisosDoTitulo avisos={titulo.avisos} duplicatas={titulo.duplicatas} />

      <div className="doc-secao">
        <span className="doc-secao__titulo">Identificação</span>
      <FormGrid cols={3}>
        <Select
          label="Fornecedor" value={supplierId} onChange={(evento) => setSupplierId(evento.target.value)}
          placeholder="Selecione…"
          options={fornecedores.map((fornecedor) => ({ value: fornecedor.id, label: fornecedor.name }))}
          hint={titulo.fornecedor.cadastrado ? "identificado pelo CNPJ" : "não encontrado pelo CNPJ — escolha"}
        />
        <Select
          label="Empresa" value={companyId} onChange={(evento) => setCompanyId(evento.target.value)}
          placeholder="Selecione…"
          options={empresas.map((empresa) => ({ value: empresa.id, label: empresa.tradeName }))}
          hint={titulo.empresa ? "identificada pelo CNPJ do documento" : "não identificada"}
        />
        <TextField label="Número da nota" value={numeroNota} onChange={(evento) => setNumeroNota(evento.target.value)} />
      </FormGrid>

      <FormGrid cols={2}>
        <TextField label="Emissão" type="date" value={emissao} onChange={(evento) => setEmissao(evento.target.value)} />
      </FormGrid>
      </div>

      <div className="doc-secao">
        <span className="doc-secao__titulo">Itens da nota</span>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          Escolha o produto de cada linha — categoria e subcategoria vêm dele automaticamente.
        </span>

        {linhas.map((linha, indice) => (
          <div key={indice} className="doc-item-linha">
            <div style={{ minWidth: 0 }}>
              {linha.descricaoLida && (
                <div className="doc-item-linha__lido">
                  lido: {linha.descricaoLida}
                </div>
              )}
              <SeletorProduto
                selecionado={linha.produto}
                descricaoLida={linha.descricaoLida}
                sugestao={sugestaoOferecida(titulo.sugestoesItens?.[indice])}
                onSelecionar={(produto) => alterarLinha(indice, { produto })}
              />
            </div>
            <div className="doc-item-linha__numeros">
            <TextField label={indice === 0 ? "Qtd" : undefined} aria-label={`Quantidade da linha ${indice + 1}`}
              inputMode="decimal"
              value={linha.quantidade} onChange={(evento) => alterarLinha(indice, { quantidade: evento.target.value })} />
            {/* Mesmo campo da tela de Compras: numerico, passo de centavo. */}
            <TextField label={indice === 0 ? "Unitário" : undefined} aria-label={`Preço unitário da linha ${indice + 1}`}
              type="number" step="0.01" inputMode="decimal" placeholder="0,00"
              value={linha.precoUnitario}
              onChange={(evento) => alterarLinha(indice, { precoUnitario: evento.target.value })} />
            <div className="doc-item-linha__total">
              {dinheiro(numero(linha.quantidade) * numero(linha.precoUnitario))}
            </div>
            <button type="button" className="doc-item-linha__remover" title="Remover linha" disabled={linhas.length === 1}
              onClick={() => setLinhas((atual) => atual.filter((_, i) => i !== indice))}>
              <Trash2 size={14} />
            </button>
            </div>
          </div>
        ))}

        <div>
          <Button variant="secondary" onClick={() => setLinhas((atual) => [...atual, { descricaoLida: "", produto: null, quantidade: "1", precoUnitario: "" }])} leadingIcon={<Plus size={13} />}>
            Adicionar linha
          </Button>
        </div>

        {/* Quando os itens fecham com o documento, repetir o mesmo numero duas
          * vezes so polui — uma confirmacao basta. A divergencia e que precisa
          * de peso: e ela que impede o lancamento. */}
        <div className={`doc-total${totalBate ? "" : " doc-total--diverge"}`}>
          <span className="doc-total__rotulo">Total dos itens</span>
          <span className="doc-total__valor">
            {dinheiro(totalItens)}
            {totalBate
              ? <Check size={14} className="doc-total__check" />
              : <span className="doc-total__diferenca">
                  {dinheiro(Math.abs(diferenca))} {diferenca > 0 ? "acima" : "abaixo"} do documento ({dinheiro(valorDocumento)})
                </span>}
          </span>
        </div>
      </div>

      <div className="doc-secao">
      <ParcelasEditor
        parcelas={parcelas}
        totalEsperado={totalItens}
        formasPagamento={formasPagamento}
        paymentMethodId={paymentMethodId}
        onFormaChange={setPaymentMethodId}
        onChange={setParcelas}
      />
      </div>

      <div className="doc-acao">
        {lancado ? (
          <StatusBadge tone="success"><CheckCircle2 size={12} /> Lançado — compra {lancado}</StatusBadge>
        ) : (
          <>
            <Button onClick={() => void lancar()} disabled={!podeLancar} leadingIcon={lancando ? <Loader2 size={14} /> : <CheckCircle2 size={14} />}>
              {lancando ? "Lançando…" : "Lançar em Contas a Pagar"}
            </Button>
            <span className="doc-acao__motivo">
              {bloqueios.length > 0
                ? "Corrija o bloqueio acima antes de lançar."
                : !totalBate
                  ? "O total dos itens precisa bater com o valor do documento."
                  : !parcelasFecham
                    ? "A soma das parcelas precisa fechar com o total da compra."
                    : faltando.length > 0
                      ? `Falta preencher: ${faltando.join(", ")}.`
                      : `Vai gravar uma compra de ${dinheiro(totalItens)} em ${parcelas.length === 1 ? "parcela única" : `${parcelas.length} parcelas`}.`}
            </span>
          </>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}
