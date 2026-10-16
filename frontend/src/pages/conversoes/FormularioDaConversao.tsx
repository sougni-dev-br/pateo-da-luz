import { CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { ApiError, cadastrarConversao } from "../../api/client";
import { Button } from "../../design-system";
import { formatarQuantidade } from "../desperdicio/quantidade";

export const nomeDaUnidade = (unidade: string) => unidade;

const fatorEmTexto = (valor: number) => String(valor).replace(".", ",");

type Props = {
  produtoId: string;
  /** Unidade em que o estoque é contado: o resultado da conversão. */
  contagem: string;
  /** Unidade que se quer converter. */
  unidade: string;
  sugestao: number | null;
  rotuloDaSugestao?: string;
  aoSalvar: (mensagem: string, conversao: { fromUnit: string; toUnit: string; factor: number }) => void;
};

/** "1 UN (unidade ou peça) = [ 3,5 ] KG  [Salvar]": o cadastro de uma conversão, na própria linha. */
export function FormularioDaConversao({ produtoId, contagem, unidade, sugestao, rotuloDaSugestao, aoSalvar }: Props) {
  const [fator, setFator] = useState(sugestao != null ? fatorEmTexto(sugestao) : "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    if (salvando || fator.trim() === "") return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await cadastrarConversao({ productId: produtoId, fromUnit: unidade, factor: fator });
      aoSalvar(`1 ${r.conversao.fromUnit} = ${formatarQuantidade(r.conversao.factor)} ${r.conversao.toUnit} cadastrada${r.comprasConvertidas > 0 ? ` · ${r.comprasConvertidas} compras convertidas` : ""}.`, r.conversao);
    } catch (falha) {
      setErro(falha instanceof ApiError || falha instanceof Error ? falha.message : "Não foi possível cadastrar a conversão.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="cv-form">
      <span className="cv-igual">1 {nomeDaUnidade(unidade)} =</span>
      <input
        className="cv-fator"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0,0"
        aria-label={`Quanto vale 1 ${unidade} em ${contagem}`}
        value={fator}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { setFator(e.target.value); setErro(null); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void salvar(); } }}
      />
      <span className="cv-igual">{contagem}</span>
      <Button variant="primary" leadingIcon={<CheckCircle2 size={14} />} disabled={salvando || fator.trim() === ""} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button>
      {sugestao != null && rotuloDaSugestao && <small className="cv-sugestao">{rotuloDaSugestao}</small>}
      {erro && <p className="req-banner is-erro cv-erro" role="alert"><span>{erro}</span></p>}
    </div>
  );
}
