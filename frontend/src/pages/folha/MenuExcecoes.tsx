import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Coins, Palmtree, UserMinus } from "lucide-react";
import "../../design-system/components/RowMenu.css";

type Props = { onFerias: () => void; onAfastamento: () => void; onManual: () => void };

/** Férias, afastamento e lançamento à mão: acontecem de vez em quando, então ficam num menu só. */
export function MenuExcecoes({ onFerias, onAfastamento, onManual }: Props) {
  const itens = [
    { rotulo: "Lançar férias", icone: <Palmtree size={15} />, acao: onFerias },
    { rotulo: "Lançar afastamento", icone: <UserMinus size={15} />, acao: onAfastamento },
    { rotulo: "Lançar à mão", icone: <Coins size={15} />, acao: onManual },
  ];
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>
        <button type="button" className="ds-button ds-button-md ds-button-secondary">Exceções <ChevronDown size={14} aria-hidden /></button>
      </RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content className="ds-row-menu-content" align="end" sideOffset={4}>
          {itens.map((i) => (
            <RadixDropdown.Item key={i.rotulo} className="ds-row-menu-item" onSelect={i.acao}>
              <span className="ds-row-menu-item-icon">{i.icone}</span>
              {i.rotulo}
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
