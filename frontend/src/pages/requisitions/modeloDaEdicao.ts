import type { InventoryRequisition } from "../../api/client";
import { lerNumero } from "../../lib/fichaTecnica";
import type { Escolha, Escolhas } from "./catalogo";
import type { DadosDoCabecalho } from "./rascunho";
import type { EdicaoDaRequisicao, ModeloInicial } from "./FormularioDaRequisicao";

const arredondar = (valor: number) => Math.round(valor * 10000) / 10000;

/** Quanto a requisição tirou de cada produto. Produto em duas linhas soma. */
export function retiradoPorProduto(req: InventoryRequisition): Record<string, number> {
  const retirado: Record<string, number> = {};
  for (const item of req.items ?? []) {
    if (item.productId) retirado[item.productId] = arredondar((retirado[item.productId] ?? 0) + Number(item.quantity));
  }
  return retirado;
}

/**
 * Retirada como o formulário edita: quantidade com vírgula, na unidade em que foi gravada.
 * O mesmo produto em duas linhas vira uma só com a soma: guardar só a última devolveria a outra ao estoque.
 */
/** Unidade em que cada produto foi gravado (a primeira linha dele). */
function unidadesGravadas(req: InventoryRequisition): Record<string, string> {
  const unidade: Record<string, string> = {};
  for (const item of req.items ?? []) {
    if (item.productId && !(item.productId in unidade)) unidade[item.productId] = item.recordedUnit ?? item.unit ?? "UN";
  }
  return unidade;
}

export function escolhasDaRequisicao(req: InventoryRequisition): Escolhas {
  const unidade = unidadesGravadas(req);
  const escolhas: Escolhas = {};
  for (const [productId, quantidade] of Object.entries(retiradoPorProduto(req))) {
    escolhas[productId] = { unit: unidade[productId], quantity: String(quantidade).replace(".", ",") };
  }
  return escolhas;
}

/** A data da requisição é gravada como meia-noite UTC: lida em UTC, como no formatDate, para não voltar um dia. */
export const dataDaRequisicao = (valor: string) => new Date(valor).toISOString().slice(0, 10);

/** O formulário de lançamento aberto sobre uma requisição registrada. Exige a versão para salvar. */
export function modeloDeEdicao(req: InventoryRequisition & { updatedAt: string }): ModeloInicial {
  return {
    cabecalho: { date: dataDaRequisicao(req.date), shift: req.shift, reason: req.reason, reasonNotes: req.reasonNotes ?? "", sectorId: req.sectorId ?? "", notes: req.notes ?? "" },
    escolhas: escolhasDaRequisicao(req),
    edicao: versaoDaEdicao(req)
  };
}

/** Versão e retirada da requisição como está no servidor: o que o salvar compara e o que volta ao saldo. */
export function versaoDaEdicao(req: InventoryRequisition & { updatedAt: string }): EdicaoDaRequisicao {
  return { id: req.id, code: req.code, updatedAt: req.updatedAt, retirado: retiradoPorProduto(req), unidadeRetirada: unidadesGravadas(req) };
}

type Versao = { cabecalho: DadosDoCabecalho; escolhas: Escolhas };

const CAMPOS_DO_CABECALHO: Array<[keyof DadosDoCabecalho, string]> = [
  ["date", "data"], ["shift", "turno"], ["reason", "motivo"], ["reasonNotes", "detalhe do motivo"], ["sectorId", "setor"], ["notes", "observação"]
];

/** Quantidade que conta como item; vazia ou zero é o mesmo que não ter o produto. */
function quantidadeDe(escolha: Escolha | undefined): number {
  const n = escolha ? lerNumero(escolha.quantity) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const mesmaEscolha = (a: Escolha | undefined, b: Escolha | undefined) =>
  quantidadeDe(a) === quantidadeDe(b) && (quantidadeDe(a) === 0 || (a?.unit ?? "").toUpperCase() === (b?.unit ?? "").toUpperCase());

/**
 * Junta a versão que outra pessoa salvou com o que esta tela mudou desde que abriu (a `base`): o que a
 * pessoa mexeu fica como ela deixou; o que ela não mexeu vem do servidor. Assim salvar de novo não apaga
 * a edição da outra pessoa. `doServidor` lista o que mudou na tela por vir da outra versão.
 */
export function juntarVersoes(base: Versao, minha: Versao, servidor: Versao, nomeDoProduto: (id: string) => string) {
  const doServidor: string[] = [];
  const cabecalho = { ...minha.cabecalho };
  for (const [campo, rotulo] of CAMPOS_DO_CABECALHO) {
    if (minha.cabecalho[campo] === base.cabecalho[campo] && servidor.cabecalho[campo] !== minha.cabecalho[campo]) {
      cabecalho[campo] = servidor.cabecalho[campo];
      doServidor.push(rotulo);
    }
  }
  const escolhas: Escolhas = {};
  const produtos = new Set([...Object.keys(base.escolhas), ...Object.keys(minha.escolhas), ...Object.keys(servidor.escolhas)]);
  for (const id of produtos) {
    const mexeu = !mesmaEscolha(minha.escolhas[id], base.escolhas[id]);
    const fica = mexeu ? minha.escolhas[id] : servidor.escolhas[id];
    if (!mexeu && !mesmaEscolha(servidor.escolhas[id], minha.escolhas[id])) doServidor.push(nomeDoProduto(id));
    if (quantidadeDe(fica) > 0) escolhas[id] = fica!;
    else if (minha.escolhas[id] && mexeu) escolhas[id] = minha.escolhas[id];
  }
  return { cabecalho, escolhas, doServidor };
}
