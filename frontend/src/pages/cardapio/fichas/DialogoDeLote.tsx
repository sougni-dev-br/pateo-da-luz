import { useState, type FormEvent } from "react";
import type { DishCategory, DishMenu } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Alert, Button, Select } from "../../../design-system";
import { ROTULO_DO_CARDAPIO, opcoesDeCategoria } from "../../../lib/categoriasDasFichas";

export type EscolhaDoLote = { menu?: DishMenu; categoryId?: string | null };

type Props = {
  aberto: boolean;
  /** Quantos pratos estão selecionados. */
  quantidade: number;
  /** Cardápios que os pratos selecionados têm hoje (um ou dois). */
  cardapiosAtuais: DishMenu[];
  categorias: DishCategory[];
  onFechar: () => void;
  /** Rejeita com a mensagem do servidor quando não dá. */
  onAplicar: (escolha: EscolhaDoLote) => Promise<void>;
};

const MANTER = "";
const SEM_CATEGORIA = "__sem__";

/** Arruma vários pratos de uma vez: cardápio e/ou categoria. Pensado para os pratos importados da 99. */
export function DialogoDeLote({ aberto, quantidade, cardapiosAtuais, categorias, onFechar, onAplicar }: Props) {
  const [menu, setMenu] = useState<"" | DishMenu>(MANTER);
  const [categoria, setCategoria] = useState(MANTER);
  const [erro, setErro] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);

  // A categoria só vale para um cardápio: o escolhido ou, se manteve, o único que a seleção tem.
  const cardapioDaCategoria: DishMenu | null = menu || (cardapiosAtuais.length === 1 ? cardapiosAtuais[0] : null);
  const opcoes = cardapioDaCategoria ? opcoesDeCategoria(categorias, cardapioDaCategoria) : [];
  const algoParaAplicar = menu !== MANTER || categoria !== MANTER;

  async function aplicar(evento: FormEvent) {
    evento.preventDefault();
    if (!algoParaAplicar) return;
    setAplicando(true);
    setErro(null);
    try {
      await onAplicar({
        ...(menu ? { menu } : {}),
        ...(categoria === SEM_CATEGORIA ? { categoryId: null } : categoria ? { categoryId: categoria } : {})
      });
      onFechar();
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Não foi possível aplicar.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(aberta) => { if (!aberta) onFechar(); }}
      title={`Organizar ${quantidade} prato${quantidade === 1 ? "" : "s"}`}
      description="Escolha só o que quer mudar; o resto fica como está. Ingredientes e preços não são alterados."
    >
      <form className="ft-dialogo" onSubmit={aplicar}>
        <Select
          label="Cardápio"
          value={menu}
          onChange={(evento) => { setMenu(evento.target.value as "" | DishMenu); setCategoria(MANTER); }}
          placeholder="Manter como está"
          options={[{ value: "CARDAPIO", label: ROTULO_DO_CARDAPIO.CARDAPIO }, { value: "DELIVERY", label: ROTULO_DO_CARDAPIO.DELIVERY }]}
        />
        <Select
          label="Categoria"
          value={categoria}
          onChange={(evento) => setCategoria(evento.target.value)}
          placeholder={cardapioDaCategoria ? "Manter como está" : "Escolha o cardápio para liberar as categorias"}
          disabled={!cardapioDaCategoria}
          options={[{ value: SEM_CATEGORIA, label: "Tirar da categoria (sem categoria)" }, ...opcoes]}
          hint={menu && cardapiosAtuais.some((atual) => atual !== menu) ? "Quem tinha categoria do outro cardápio fica sem ela, a não ser que você escolha uma aqui." : undefined}
        />
        {erro && <Alert tone="error">{erro}</Alert>}
        <div className="ft-dialogo-acoes">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={!algoParaAplicar || aplicando}>{aplicando ? "Aplicando…" : "Aplicar"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
