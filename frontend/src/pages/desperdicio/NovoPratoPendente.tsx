import { useState } from "react";
import { ApiError, createWastePendingDish, type WasteProductHit } from "../../api/client";
import { Button, Select, TextField, Textarea } from "../../design-system";

type Props = {
  nomeInicial: string;
  /** `jaExistia`: o nome já era de um prato (com ficha ou aguardando), que passa a ser o escolhido em vez de criar outro. */
  onCriado: (prato: WasteProductHit, jaExistia: boolean) => void;
  onCancelar: () => void;
};

const UNIDADES = [
  { value: "KG", label: "Quilo (kg): pesa a sobra" },
  { value: "UN", label: "Porção (UN): conta as porções" },
];

/**
 * O prato não está na lista: quem lança o cria aqui, na hora. Ele fica aguardando a ficha técnica (quem cuida das
 * fichas monta depois) e o lançamento já vale: o valor entra quando a ficha for concluída.
 */
export function NovoPratoPendente({ nomeInicial, onCriado, onCancelar }: Props) {
  const [nome, setNome] = useState(nomeInicial);
  const [unidade, setUnidade] = useState<"KG" | "UN">("KG");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function cadastrar() {
    setSalvando(true);
    setErro(null);
    try {
      onCriado(await createWastePendingDish({ name: nome, unit: unidade, ...(observacao.trim() ? { notes: observacao } : {}) }), false);
    } catch (falha) {
      const existente = falha instanceof ApiError && falha.status === 409 ? (falha.body?.existing as WasteProductHit | undefined) : undefined;
      if (existente) onCriado(existente, true);
      else setErro(falha instanceof Error ? falha.message : "Não foi possível cadastrar o prato.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="waste-novo-form" role="group" aria-label="Cadastrar prato novo">
      <p className="waste-novo-titulo">Prato novo: fica aguardando a ficha técnica. O lançamento vale já, e o valor aparece quando a ficha for concluída.</p>
      <TextField id="waste-novo-nome" label="Nome do prato" value={nome} maxLength={80} onChange={(event) => setNome(event.target.value)} autoComplete="off" autoFocus />
      <Select id="waste-novo-unidade" label="Como se mede a sobra" value={unidade} options={UNIDADES} onChange={(event) => setUnidade(event.target.value as "KG" | "UN")} />
      <Textarea
        id="waste-novo-obs"
        label="O que leva (opcional)"
        hint="Ajuda quem vai montar a ficha: ingredientes, de onde vem."
        rows={2}
        maxLength={300}
        value={observacao}
        onChange={(event) => setObservacao(event.target.value)}
      />
      {erro && <p className="waste-error" role="alert">{erro}</p>}
      <div className="waste-novo-acoes">
        <Button variant="secondary" disabled={salvando} onClick={onCancelar}>Cancelar</Button>
        <Button variant="primary" disabled={salvando || nome.trim().length < 3} onClick={() => void cadastrar()}>{salvando ? "Cadastrando…" : "Cadastrar e usar"}</Button>
      </div>
    </div>
  );
}
