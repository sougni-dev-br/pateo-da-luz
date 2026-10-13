import { Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  createDishListing,
  deleteDishListing,
  getDishDeliveryStores,
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

  const [dialogo, setDialogo] = useState<{ listagem: DishListing | null } | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);

  if (!vendeNoDelivery && listagens.length === 0) return null;

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
        <table className="ft-tabela">
          <thead>
            <tr>
              <th scope="col">Onde</th>
              <th scope="col">Loja</th>
              <th scope="col" className="ft-num">Preço</th>
              <th scope="col" className="ft-num">CMV</th>
              {podeEditar && <th scope="col"><span className="ft-so-leitor">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {vendeNoSalao && (
              <tr>
                <th scope="row" data-rotulo="Onde">Salão (a la carte)</th>
                <td data-rotulo="Loja">—</td>
                <td className="ft-num" data-rotulo="Preço">
                  {prato.salePriceDefault != null ? <Money value={prato.salePriceDefault} /> : "—"}
                </td>
                <td className="ft-num" data-rotulo="CMV"><CmvDoPreco custo={custo} preco={prato.salePriceDefault} /></td>
                {podeEditar && (
                  <td className="ft-acoes-linha">
                    <button type="button" className="ft-link" onClick={onEditarPrato}>
                      {prato.salePriceDefault != null ? "Alterar" : "Definir"}
                    </button>
                  </td>
                )}
              </tr>
            )}
            {listagens.map((listagem) => (
              <tr key={listagem.id} className={listagem.isActive ? undefined : "ft-linha-inativa"}>
                <th scope="row" data-rotulo="Onde">{rotuloDoCanal(listagem.channel)}</th>
                <td data-rotulo="Loja">
                  {listagem.storeName ?? "Sem loja"}
                  {!listagem.isActive && <StatusBadge tone="neutral" className="ft-etiqueta">Pausado</StatusBadge>}
                </td>
                <td className="ft-num" data-rotulo="Preço"><Money value={listagem.price} /></td>
                <td className="ft-num" data-rotulo="CMV"><CmvDoPreco custo={custo} preco={listagem.price} /></td>
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
            ))}
            {listagens.length === 0 && (
              <tr>
                <td colSpan={podeEditar ? 5 : 4} className="ft-nota">Nenhuma loja do delivery tem preço para este prato ainda.</td>
              </tr>
            )}
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
        O CMV é o custo da ficha sobre o preço de tabela de cada linha. Nas plataformas o desconto costuma ser bancado em boa
        parte pela loja, então o líquido que entra fica abaixo da tabela e o CMV real é maior. Cada loja pode ter o seu preço.
      </p>

      {dialogo && (
        <DialogoDePreco
          prato={prato}
          listagem={dialogo.listagem}
          onFechar={() => setDialogo(null)}
          onSalvo={() => { setDialogo(null); onMudou(); }}
          notificar={notificar}
        />
      )}
    </section>
  );
}

function DialogoDePreco({ prato, listagem, onFechar, onSalvo, notificar }: {
  prato: DishDetail;
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
  const jaTem = new Set(prato.listings.map((item) => item.deliveryStoreId).filter(Boolean));
  const opcoes = (lojas ?? [])
    .filter((loja) => !jaTem.has(loja.id))
    .map((loja) => ({ value: loja.id, label: `${rotuloDoCanal(loja.platform)} · ${loja.nickname}` }));

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
