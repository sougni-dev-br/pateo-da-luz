import { Printer } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { DishCategory, DishMenu } from "../../../api/client";
import { Dialog } from "../../../components/ui/Dialog";
import { Button, Select, TextField } from "../../../design-system";
import { ROTULO_DO_CARDAPIO, opcoesDeCategoria } from "../../../lib/categoriasDasFichas";
import {
  LINHAS_PADRAO, MAXIMO_DE_COPIAS, OPCOES_DE_LINHAS, copiasDaFolha, folhaEmBranco, type FolhaDados
} from "../../../lib/folhaDaFicha";

type Props = {
  aberto: boolean;
  categorias: DishCategory[];
  onFechar: () => void;
  onImprimir: (folhas: FolhaDados[]) => void;
};

/** Ficha em branco para a equipe levar para a cozinha e preencher à mão; depois é só digitar no sistema. */
export function DialogoDeImpressao({ aberto, categorias, onFechar, onImprimir }: Props) {
  const [menu, setMenu] = useState<"" | DishMenu>("");
  const [categoriaId, setCategoriaId] = useState("");
  const [copias, setCopias] = useState("5");
  const [linhas, setLinhas] = useState(String(LINHAS_PADRAO));

  const opcoesDaCategoria = menu ? opcoesDeCategoria(categorias, menu) : [];
  const numeroDeCopias = Number(copias);
  const copiasValidas = Number.isInteger(numeroDeCopias) && numeroDeCopias >= 1 && numeroDeCopias <= MAXIMO_DE_COPIAS;

  function imprimir(evento: FormEvent) {
    evento.preventDefault();
    if (!copiasValidas) return;
    const categoria = categorias.find((candidata) => candidata.id === categoriaId);
    const pai = categoria?.parentId ? categorias.find((candidata) => candidata.id === categoria.parentId) : null;
    const folha = folhaEmBranco({
      linhas: Number(linhas),
      menu: menu || null,
      categoria: pai?.name ?? categoria?.name ?? "",
      subcategoria: pai ? categoria?.name ?? "" : ""
    });
    onImprimir(copiasDaFolha(folha, numeroDeCopias));
    onFechar();
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(aberta) => { if (!aberta) onFechar(); }}
      title="Imprimir ficha em branco"
      description="A ficha sai em A4, com o mesmo roteiro da tela: depois de preenchida à mão, é só digitar no sistema. Na janela de impressão você pode escolher a impressora ou Salvar como PDF."
    >
      <form className="ft-dialogo" onSubmit={imprimir}>
        <Select
          label="Cardápio já marcado na folha"
          value={menu}
          onChange={(evento) => { setMenu(evento.target.value as "" | DishMenu); setCategoriaId(""); }}
          placeholder="Deixar em branco"
          options={[{ value: "CARDAPIO", label: ROTULO_DO_CARDAPIO.CARDAPIO }, { value: "DELIVERY", label: ROTULO_DO_CARDAPIO.DELIVERY }]}
        />
        <Select
          label="Categoria já escrita na folha"
          value={categoriaId}
          onChange={(evento) => setCategoriaId(evento.target.value)}
          placeholder={menu ? "Deixar em branco" : "Escolha o cardápio primeiro"}
          disabled={!menu}
          options={opcoesDaCategoria}
        />
        <div className="ft-dialogo-duplo">
          <TextField
            label="Quantas folhas"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAXIMO_DE_COPIAS}
            value={copias}
            onChange={(evento) => setCopias(evento.target.value)}
            error={copiasValidas ? undefined : `Entre 1 e ${MAXIMO_DE_COPIAS}.`}
          />
          <Select
            label="Linhas de ingrediente"
            value={linhas}
            onChange={(evento) => setLinhas(evento.target.value)}
            options={OPCOES_DE_LINHAS.map((n) => ({ value: String(n), label: `${n} linhas` }))}
          />
        </div>
        <div className="ft-dialogo-acoes">
          <Button variant="secondary" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" disabled={!copiasValidas} leadingIcon={<Printer size={16} aria-hidden />}>Imprimir</Button>
        </div>
      </form>
    </Dialog>
  );
}
