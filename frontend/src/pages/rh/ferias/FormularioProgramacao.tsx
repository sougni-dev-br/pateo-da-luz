import { useState } from "react";
import type { ComponentProps } from "react";
import { FormularioFerias } from "./FormularioFerias";
import { FormularioParcelado, type DadosParcelados } from "./FormularioParcelado";
import { MIN_DIAS_PARA_PARCELAR } from "./parcelamento";

type PropsIntegral = ComponentProps<typeof FormularioFerias>;
type Props = PropsIntegral & { onSalvarParcelado: (dados: DadosParcelados) => void };

type Modo = "INTEGRAL" | "PARCELADA";

const OPCOES: ReadonlyArray<readonly [Modo, string]> = [["INTEGRAL", "Integrais (de uma vez)"], ["PARCELADA", "Parceladas (em 2 ou 3 partes)"]];

/**
 * Ao programar férias de um período ainda inteiro, pergunta primeiro: integral ou parcelada?
 * Parcelada lança as 2 ou 3 partes de uma vez; integral e a edição seguem o formulário de sempre.
 */
export function FormularioProgramacao({ onSalvarParcelado, ...integral }: Props) {
  const { periodo, inicial, nome } = integral;
  const podeParcelar = !inicial && periodo.programacoes.length === 0 && periodo.diasPendentes >= MIN_DIAS_PARA_PARCELAR;
  const [modo, setModo] = useState<Modo>("INTEGRAL");
  if (!podeParcelar) return <FormularioFerias {...integral} />;
  return (
    <div className="fe-programacao-form">
      <fieldset className="fe-escolha">
        <legend>As férias de {nome} serão:</legend>
        {OPCOES.map(([valor, rotulo]) => (
          <label key={valor} className="fe-escolha-opcao">
            <input type="radio" name={`modo-${periodo.aquisitivoInicio}`} value={valor} checked={modo === valor} onChange={() => setModo(valor)} />
            {rotulo}
          </label>
        ))}
      </fieldset>
      {/* Os dois ficam montados: alternar não apaga o que já foi digitado nem tira o foco do radio. Só o ativo desenha a prévia. */}
      <div hidden={modo !== "INTEGRAL"}>
        <FormularioFerias {...integral} onPrevia={modo === "INTEGRAL" ? integral.onPrevia : undefined} />
      </div>
      <div hidden={modo !== "PARCELADA"}>
        <FormularioParcelado nome={nome} periodo={periodo} regras={integral.regras} sugestao={integral.sugestao} autoFoco={false}
          onPrevia={modo === "PARCELADA" ? integral.onPrevia : undefined} salvando={integral.salvando} erro={integral.erro}
          onSalvar={onSalvarParcelado} onCancelar={integral.onCancelar} />
      </div>
    </div>
  );
}
