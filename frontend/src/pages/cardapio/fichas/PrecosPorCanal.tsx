import { Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  createDishListing,
  deleteDishListing,
  getDishDeliveryStores,
  getDishNetRatios,
  updateDishListing,
  type DishDeliveryStore,
  type DishDetail,
  type DishListing
} from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, Money, Select, StatusBadge, TextField } from "../../../design-system";
import { menusDoPrato } from "../../../lib/categoriasDasFichas";
import { faixaDeCmv, lerNumero, rotuloDoCanal } from "../../../lib/fichaTecnica";
import { formatPercent } from "../../../utils/format";

type Props = {
  prato: DishDetail;
  canEdit: boolean;
  onEditarPrato: () => void;
  /** Depois de lançar, alterar ou remover um preço: a tela recarrega o prato. */
  onMudou: () => void;
  notificar: (tom: "success" | "error", mensagem: string) => void;
};

/** As plataformas de delivery aparecem sempre na ficha, com ou sem preço lançado: sem isso não há como saber que existem. */
const PLATAFORMAS_DO_DELIVERY = ["NOVENTA_NOVE", "IFOOD", "KEETA"] as const;

const mensagemDe = (erro: unknown, padrao: string) => (erro instanceof Error && erro.message ? erro.message : padrao);

/** Salão primeiro, depois cada plataforma e cada loja dela. */
function ordenar(listagens: DishListing[]): DishListing[] {
  return [...listagens].sort(
    (a, b) => a.channel.localeCompare(b.channel) || (a.storeName ?? "").localeCompare(b.storeName ?? "", "pt-BR")
  );
}

function CmvDoPreco({ custo, preco }: { custo: number | null; preco: number | null }) {
  if (custo == null || preco == null || preco <= 0) return <>—</>;
  const cmv = (custo / preco) * 100;
  return <StatusBadge tone={faixaDeCmv(cmv)?.tom ?? "neutral"}>{formatPercent(cmv)}</StatusBadge>;
}

/**
 * O prato tem um preço no salão (a la carte) e um preço por loja de cada plataforma de delivery — 99, iFood, Keeta —
 * e o preço pode mudar de uma loja para outra dentro da mesma plataforma. O da 99 vem do cardápio dela; os outros
 * são lançados aqui. O CMV de cada linha é o custo da ficha sobre o preço daquela linha.
 */
export function PrecosPorCanal({ prato, canEdit, onEditarPrato, onMudou, notificar }: Props) {
  const nosCardapios = menusDoPrato(prato);
  const vendeNoSalao = nosCardapios.includes("CARDAPIO");
  const vendeNoDelivery = nosCardapios.includes("DELIVERY");
  const listagens = ordenar(prato.listings);
  const podeEditar = canEdit && prato.isActive;
  const custo = prato.items.length > 0 && !prato.custoIncompleto ? prato.custoPorcao : null;
  // O delivery tem as próprias quantidades quando o prato é vendido nos dois: sem elas não há CMV de lá
  // (as do a la carte não valem). Prato só do delivery, ou ainda não marcado nos dois, usa a ficha que tem.
  const temFichaPropriaDoDelivery = prato.alsoMenu === "DELIVERY";
  const itensDoDelivery = prato.alsoItems?.length ?? 0;
  const custoDoDelivery = temFichaPropriaDoDelivery
    ? itensDoDelivery > 0 && !prato.alsoCusto?.custoIncompleto ? prato.alsoCusto?.custoPorcao ?? null : null
    : custo;
  const faltaQuantidadeDoDelivery = temFichaPropriaDoDelivery && itensDoDelivery === 0;

  const [dialogo, setDialogo] = useState<{ listagem: DishListing | null; plataforma?: string } | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);
  const [razoes, setRazoes] = useState<Map<string, number>>(new Map());

  // Quanto do preço de tabela da 99 chega ao caixa em cada loja; se não vier, a coluna do líquido some.
  useEffect(() => {
    let vivo = true;
    getDishNetRatios()
      .then((resposta) => {
        if (!vivo) return;
        const lojas = (resposta.canais ?? [{ lojas: resposta.lojas }]).flatMap((canal) => canal.lojas);
        setRazoes(new Map(lojas.filter((loja) => loja.razao != null).map((loja) => [loja.deliveryStoreId, loja.razao as number])));
      })
      .catch(() => { if (vivo) setRazoes(new Map()); });
    return () => { vivo = false; };
  }, [prato.id]);

  // Líquido estimado: o preço da loja × a razão medida dela (99: sobre a tabela; iFood e Keeta: sobre o faturamento lançado).
  const liquidoDa = (listagem: DishListing): number | null => {
    const razao = razoes.get(listagem.deliveryStoreId ?? `plataforma:${listagem.channel}`);
    return razao != null ? listagem.price * razao : null;
  };
  const comLiquido = listagens.some((listagem) => liquidoDa(listagem) != null);

  if (!vendeNoDelivery && listagens.length === 0) return null;

  // Ordem fixa: 99, iFood, Keeta e, depois, qualquer outro canal que já tenha preço. As plataformas de delivery sem
  // preço entram como uma linha para lançar (ou para avisar que a 99 vem do cardápio dela).
  const canais = [
    ...(vendeNoDelivery ? PLATAFORMAS_DO_DELIVERY : PLATAFORMAS_DO_DELIVERY.filter((canal) => listagens.some((listagem) => listagem.channel === canal))),
    ...Array.from(new Set(listagens.map((listagem) => listagem.channel))).filter((canal) => !(PLATAFORMAS_DO_DELIVERY as readonly string[]).includes(canal))
  ];
  const colunas = 3 + (comLiquido ? 2 : 0) + (podeEditar ? 1 : 0);

  async function remover(listagem: DishListing) {
    setRemovendo(listagem.id);
    try {
      await deleteDishListing(prato.id, listagem.id);
      notificar("success", `Preço de ${listagem.storeName ?? "loja"} removido.`);
      onMudou();
    } catch (erro) {
      notificar("error", mensagemDe(erro, "Não foi possível remover o preço."));
    } finally {
      setRemovendo(null);
    }
  }

  return (
    <section className="ft-secao" aria-labelledby="ft-precos">
      <h3 id="ft-precos" className="ft-secao-titulo">Preços por canal</h3>
      <div className="ft-tabela-rolagem">
        <table className="ft-tabela ft-tabela--precos">
          <thead>
            <tr>
              <th scope="col">Onde / loja</th>
              <th scope="col" className="ft-num">Preço</th>
              <th scope="col" className="ft-num">CMV</th>
              {comLiquido && <th scope="col" className="ft-num" title="O que chega ao caixa: o preço × a média medida da loja">Líquido estimado</th>}
              {comLiquido && <th scope="col" className="ft-num">CMV sobre o líquido</th>}
              {podeEditar && <th scope="col"><span className="ft-so-leitor">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {vendeNoSalao && (
              <tr>
                <th scope="row" data-rotulo="Onde">Salão (a la carte)</th>
                <td className="ft-num" data-rotulo="Preço">
                  {prato.salePriceDefault != null ? <Money value={prato.salePriceDefault} /> : "—"}
                </td>
                <td className="ft-num" data-rotulo="CMV"><CmvDoPreco custo={custo} preco={prato.salePriceDefault} /></td>
                {comLiquido && <td className="ft-num ft-vazio-estreito" data-rotulo="Líquido estimado">—</td>}
                {comLiquido && <td className="ft-num ft-vazio-estreito" data-rotulo="CMV sobre o líquido">—</td>}
                {podeEditar && (
                  <td className="ft-acoes-linha">
                    <button type="button" className="ft-link" onClick={onEditarPrato}>
                      {prato.salePriceDefault != null ? "Alterar" : "Definir"}
                    </button>
                  </td>
                )}
              </tr>
            )}
            {canais.map((canal) => {
              const doCanal = listagens.filter((listagem) => listagem.channel === canal);
              if (doCanal.length === 0) {
                // Só aparecem plataformas de delivery sem preço quando o prato é vendido no delivery.
                if (!vendeNoDelivery) return null;
                return (
                  <tr key={`sem-${canal}`} className="ft-linha-sem-preco">
                    <th scope="row" data-rotulo="Onde">{rotuloDoCanal(canal)}</th>
                    <td colSpan={2 + (comLiquido ? 2 : 0)} data-rotulo="Preço" className="ft-nota">
                      Nenhuma loja com preço{canal === "NOVENTA_NOVE" ? " — vem do cardápio da 99, quando importado" : ""}
                    </td>
                    {podeEditar && (
                      <td className="ft-acoes-linha">
                        {canal !== "NOVENTA_NOVE" && (
                          <button type="button" className="ft-link" onClick={() => setDialogo({ listagem: null, plataforma: canal })}>Lançar preço</button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              }
              const automatico = doCanal.every((listagem) => !listagem.manual);
              return [
                <tr key={`grupo-${canal}`} className="ft-canal-grupo">
                  <th scope="rowgroup" colSpan={colunas}>
                    {rotuloDoCanal(canal)}
                    <span className="ft-origem">{automatico ? "preço automático, do cardápio da plataforma" : "preço lançado à mão"}</span>
                  </th>
                </tr>,
                ...doCanal.map((listagem) => (
                  <tr key={listagem.id} className={listagem.isActive ? "ft-linha-loja" : "ft-linha-loja ft-linha-inativa"}>
                    <th scope="row" data-rotulo="Loja">
                      {listagem.storeName ?? "Sem loja"}
                      {!listagem.isActive && <StatusBadge tone="neutral" className="ft-etiqueta">Pausado</StatusBadge>}
                    </th>
                    <td className="ft-num" data-rotulo="Preço"><Money value={listagem.price} /></td>
                    <td className="ft-num" data-rotulo="CMV">
                      {faltaQuantidadeDoDelivery
                        ? <span className="ft-sem-valor" title="Informe as quantidades do delivery: as do a la carte não valem para ele.">falta delivery</span>
                        : <CmvDoPreco custo={custoDoDelivery} preco={listagem.price} />}
                    </td>
                    {comLiquido && (
                      <td className="ft-num ft-num--secundario" data-rotulo="Líquido estimado">
                        {liquidoDa(listagem) != null ? <Money value={liquidoDa(listagem) as number} /> : "—"}
                      </td>
                    )}
                    {comLiquido && (
                      <td className="ft-num ft-num--secundario" data-rotulo="CMV sobre o líquido">
                        {faltaQuantidadeDoDelivery ? "—" : <CmvDoPreco custo={custoDoDelivery} preco={liquidoDa(listagem)} />}
                      </td>
                    )}
                    {podeEditar && (
                      <td className="ft-acoes-linha">
                        {listagem.manual ? (
                          <>
                            <button type="button" className="ft-link" onClick={() => setDialogo({ listagem })}>Alterar</button>
                            <button
                              type="button"
                              className="ft-link ft-link--perigo"
                              disabled={removendo === listagem.id}
                              onClick={() => void remover(listagem)}
                            >
                              Remover
                            </button>
                          </>
                        ) : (
                          <span className="ft-nota" title="Este preço vem do cardápio da plataforma; para mudar, altere no portal dela.">da plataforma</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              ];
            })}
          </tbody>
        </table>
      </div>
      {podeEditar && (
        <div>
          <Button variant="secondary" size="sm" leadingIcon={<Plus size={15} aria-hidden />} onClick={() => setDialogo({ listagem: null })}>
            Adicionar preço de uma loja
          </Button>
        </div>
      )}
      <p className="ft-nota">
        O CMV é o custo da ficha sobre o preço de cada linha. O líquido estimado é o que chega ao caixa depois do desconto, da comissão e
        das taxas, pela média medida de cada loja (na 99, sobre a tabela dos pedidos; no iFood e na Keeta, sobre o faturamento lançado).
        Cada loja pode ter o seu preço.
      </p>

      {dialogo && (
        <DialogoDePreco
          prato={prato}
          listagem={dialogo.listagem}
          plataforma={dialogo.plataforma}
          onFechar={() => setDialogo(null)}
          onSalvo={() => { setDialogo(null); onMudou(); }}
          notificar={notificar}
        />
      )}
    </section>
  );
}

function DialogoDePreco({ prato, listagem, plataforma, onFechar, onSalvo, notificar }: {
  prato: DishDetail;
  /** Veio do "Lançar preço" de uma plataforma: só as lojas dela entram na escolha. */
  plataforma?: string;
  /** null = preço novo; senão, alteração do preço lançado à mão. */
  listagem: DishListing | null;
  onFechar: () => void;
  onSalvo: () => void;
  notificar: Props["notificar"];
}) {
  const [lojas, setLojas] = useState<DishDeliveryStore[] | null>(null);
  const [lojaId, setLojaId] = useState("");
  const [preco, setPreco] = useState(listagem ? String(listagem.price) : "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (listagem) return;
    let vivo = true;
    getDishDeliveryStores()
      .then((resposta) => { if (vivo) setLojas(resposta); })
      .catch((falha) => { if (vivo) setErro(mensagemDe(falha, "Não foi possível carregar as lojas.")); });
    return () => { vivo = false; };
  }, [listagem]);

  // Uma loja, um preço por prato: as que já têm preço (importado ou lançado) não entram na escolha.
  const jaTem = new Set(prato.listings.map((item) => item.deliveryStoreId ?? `plataforma:${item.channel}`));
  const opcoes = (lojas ?? [])
    .filter((loja) => !jaTem.has(loja.id) && (!plataforma || loja.platform === plataforma))
    .map((loja) => ({ value: loja.id, label: `${rotuloDoCanal(loja.platform)} · ${loja.nickname}` }));

  // Plataforma com uma loja só (a Keeta): já vem escolhida.
  useEffect(() => {
    if (!listagem && !lojaId && opcoes.length === 1) setLojaId(opcoes[0].value);
  }, [listagem, lojaId, opcoes]);

  const valor = lerNumero(preco);
  const precoValido = Number.isFinite(valor) && valor > 0;

  async function salvar(evento: FormEvent) {
    evento.preventDefault();
    if (!precoValido || (!listagem && !lojaId)) return;
    setSalvando(true);
    setErro(null);
    try {
      if (listagem) await updateDishListing(prato.id, listagem.id, { price: valor });
      else await createDishListing(prato.id, { deliveryStoreId: lojaId, price: valor });
      notificar("success", listagem ? "Preço alterado." : "Preço lançado.");
      onSalvo();
    } catch (falha) {
      setErro(mensagemDe(falha, "Não foi possível gravar o preço."));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(aberta) => { if (!aberta) onFechar(); }}
      title={listagem ? `Preço em ${listagem.storeName ?? "loja"}` : "Preço de uma loja"}
      description={listagem ? undefined : "Cada loja, mesmo da mesma plataforma, pode ter o seu preço."}
    >
      <form className="ft-dialogo" onSubmit={salvar}>
        {!listagem && (
          <Select
            label="Loja"
            value={lojaId}
            onChange={(evento) => setLojaId(evento.target.value)}
            options={opcoes}
            placeholder={lojas === null ? "Carregando lojas…" : "Escolha a loja"}
            hint={lojas !== null && opcoes.length === 0 ? "Todas as lojas já têm preço para este prato." : undefined}
          />
        )}
        <TextField
          label="Preço (R$)"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={preco}
          onChange={(evento) => setPreco(evento.target.value)}
          placeholder="Ex.: 59,90"
          autoFocus={Boolean(listagem)}
        />
        {erro && <Alert tone="error">{erro}</Alert>}
        <div className="ft-dialogo-acoes">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={!precoValido || (!listagem && !lojaId) || salvando}>{salvando ? "Gravando…" : "Gravar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
