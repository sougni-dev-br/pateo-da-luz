import type { FichaCadastralDetalhe, FichaCadastralEmpresa } from "../../../api/client";
import { FormGrid, Select, Switch, TextField, Textarea } from "../../../design-system";
import { valorBr, valorNoCampo } from "./fichaFormato";

type Props = {
  ficha: FichaCadastralDetalhe;
  valor: FichaCadastralEmpresa;
  onChange: (v: FichaCadastralEmpresa) => void;
  somenteLeitura: boolean;
};

/** Parte que o RH completa: vai para a ficha impressa e, na admissão, para o cadastro. */
export function EmpresaFicha({ ficha, valor, onChange, somenteLeitura }: Props) {
  // Atualização: estes vêm do cadastro de hoje; mudam no próprio cadastro (com vigência).
  const doCadastro = somenteLeitura || ficha.tipo === "ATUALIZACAO";
  const mudar = <K extends keyof FichaCadastralEmpresa>(campo: K, v: FichaCadastralEmpresa[K]) => onChange({ ...valor, [campo]: v });
  const texto = (campo: keyof FichaCadastralEmpresa) => (valor[campo] == null ? "" : String(valor[campo]));
  const vazioParaNull = (s: string) => (s.trim() === "" ? null : s);
  // Dinheiro: guarda o que foi digitado; a conversão (1.500,00 → 1500) é feita no envio.
  const dinheiro = (campo: "salario" | "valorVt") => ({
    value: valorNoCampo(valor[campo]),
    error: valorBr(valor[campo]) === undefined ? "Use o formato 1.500,00." : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => mudar(campo, (e.target.value.trim() === "" ? null : e.target.value) as never),
  });
  const hora = (campo: keyof FichaCadastralEmpresa, rotulo: string) => (
    <TextField label={rotulo} type="time" value={texto(campo)} disabled={campo.startsWith("sabado") ? somenteLeitura : doCadastro}
      onChange={(e) => mudar(campo, vazioParaNull(e.target.value) as never)} />
  );
  return (
    <div className="fc-empresa">
      {ficha.tipo === "ATUALIZACAO" && (
        <p className="fc-nota">Na atualização, empresa, função, salário e jornada vêm do cadastro de hoje e só mudam lá, com a data de vigência. Aqui você completa o que vai só para a ficha impressa: sábado, folga, valor do VT e observações.</p>
      )}
      <FormGrid>
        <Select label="Empresa" value={valor.companyId ?? ""} disabled={doCadastro} placeholder="Escolha…"
          options={ficha.empresas.map((e) => ({ value: e.id, label: e.tradeName }))}
          onChange={(e) => mudar("companyId", vazioParaNull(e.target.value))} />
        <TextField label="Data de admissão" type="date" value={texto("admissao")} disabled={doCadastro} required={ficha.tipo === "ADMISSAO"}
          onChange={(e) => mudar("admissao", vazioParaNull(e.target.value))} />
        <TextField label="Função" value={texto("funcao")} disabled={doCadastro} required={ficha.tipo === "ADMISSAO"}
          onChange={(e) => mudar("funcao", vazioParaNull(e.target.value))} />
        <TextField label="Salário (R$)" inputMode="decimal" placeholder="1.500,00" disabled={doCadastro || ficha.salarioOculto}
          hint={ficha.salarioOculto ? "Oculto: exige permissão de ver Funcionários." : undefined} {...dinheiro("salario")} />
        <Select label="Vínculo" value={valor.modalidade ?? "CLT"} disabled={doCadastro}
          options={[{ value: "CLT", label: "CLT" }, { value: "NAO_CLT", label: "Sem registro" }]}
          onChange={(e) => mudar("modalidade", e.target.value as "CLT" | "NAO_CLT")} />
      </FormGrid>
      <h4 className="fc-subtitulo">Horário de trabalho</h4>
      <FormGrid>
        {hora("entrada", "Entrada")}
        {hora("intervaloInicio", "Intervalo — início")}
        {hora("intervaloFim", "Intervalo — fim")}
        {hora("saida", "Saída")}
        {hora("sabadoEntrada", "Sábado — entrada")}
        {hora("sabadoSaida", "Sábado — saída")}
        <TextField label="Folga semanal" value={texto("folga")} disabled={somenteLeitura} placeholder="Ex.: segunda-feira"
          onChange={(e) => mudar("folga", vazioParaNull(e.target.value))} />
      </FormGrid>
      <h4 className="fc-subtitulo">Vale-transporte</h4>
      <FormGrid>
        <label className="fc-switch">
          <Switch label="Recebe vale-transporte" checked={valor.valeTransporte ?? ficha.dados.usaVt === true} disabled={doCadastro}
            onChange={(v: boolean) => mudar("valeTransporte", v)} />
          <span>Recebe vale-transporte</span>
        </label>
        <TextField label="Valor do VT (R$)" inputMode="decimal" placeholder="250,00" disabled={somenteLeitura || ficha.salarioOculto} {...dinheiro("valorVt")} />
      </FormGrid>
      <Textarea label="Observações para a contabilidade" value={texto("observacoes")} disabled={somenteLeitura} rows={2}
        onChange={(e) => mudar("observacoes", vazioParaNull(e.target.value))} />
    </div>
  );
}
