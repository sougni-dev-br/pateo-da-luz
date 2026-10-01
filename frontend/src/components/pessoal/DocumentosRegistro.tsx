import { useState } from "react";
import { Button, FormField, FormGrid, FormSection, Select, TextField } from "../../design-system";
import type { FichaForm } from "./fichaRegistroForm";
import "./FichaRegistro.css";

type Props = { value: FichaForm; onChange: (f: FichaForm) => void };

const DEFICIENCIA = [
  { value: "", label: "—" },
  { value: "nao", label: "Não" },
  { value: "sim", label: "Sim" },
];

// Resumo de uma linha da seção recolhida: o que se procura quando se abre a ficha.
export function resumoDocumentos(f: FichaForm): string {
  const partes = [
    f.ctpsNumero && `CTPS ${f.ctpsNumero}${f.ctpsSerie ? ` série ${f.ctpsSerie}` : ""}${f.ctpsUf ? ` ${f.ctpsUf}` : ""}`,
    f.cbo && `CBO ${f.cbo}`,
    f.jornadaInicio && f.jornadaFim && `jornada ${f.jornadaInicio}–${f.jornadaFim}`,
    f.registroNumero && `ficha nº ${f.registroNumero}`,
    f.nomeMae && `mãe ${f.nomeMae}`,
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Nada preenchido ainda.";
}

// Seção "Documentos e contrato em carteira": o que vem da ficha de registro da contabilidade.
// Só cadastro — nenhum cálculo lê estes campos. A jornada é a do contrato; o turno real fica
// em Trabalho → turno. Recolhida por padrão: é consulta, quase nunca edição, e são 24 campos
// num formulário que já é longo.
export function DocumentosRegistro({ value, onChange }: Props) {
  const [aberta, setAberta] = useState(false);
  const campo = (c: keyof FichaForm, extra: { type?: string; maxLength?: number; placeholder?: string } = {}) => (
    <TextField {...extra} value={value[c]} onChange={(e) => onChange({ ...value, [c]: e.target.value })} />
  );
  const alternar = (
    <Button variant="secondary" size="sm" aria-expanded={aberta} onClick={() => setAberta(!aberta)}>
      {aberta ? "Recolher" : "Ver e editar"}
    </Button>
  );
  return (
    <FormSection title="Documentos e contrato em carteira" description="Como está na ficha de registro da contabilidade." actions={alternar}>
      {!aberta && <div className="documentos-registro__resumo">{resumoDocumentos(value)}</div>}
      {aberta && <FormGrid cols={4}>
        <FormField label="Nome da mãe">{campo("nomeMae")}</FormField>
        <FormField label="Nome do pai">{campo("nomePai")}</FormField>
        <FormField label="Estado civil">{campo("estadoCivil")}</FormField>
        <FormField label="Naturalidade" hint="cidade - UF">{campo("naturalidade")}</FormField>
        <FormField label="Nacionalidade">{campo("nacionalidade")}</FormField>
        <FormField label="Raça/cor">{campo("racaCor")}</FormField>
        <FormField label="Escolaridade">{campo("escolaridade")}</FormField>
        <FormField label="Pessoa com deficiência">
          <Select
            value={value.possuiDeficiencia}
            onChange={(e) => onChange({ ...value, possuiDeficiencia: e.target.value as FichaForm["possuiDeficiencia"] })}
            options={DEFICIENCIA}
          />
        </FormField>
        <FormField label="RG emitido em">{campo("rgDataEmissao", { type: "date" })}</FormField>
        <FormField label="Órgão emissor do RG">{campo("rgOrgaoEmissor", { placeholder: "SSP/SP" })}</FormField>
        <FormField label="Título de eleitor">{campo("tituloEleitor")}</FormField>
        <FormField label="Zona / seção">
          <div className="documentos-registro__par">
            {campo("tituloZona", { placeholder: "Zona" })}
            {campo("tituloSecao", { placeholder: "Seção" })}
          </div>
        </FormField>
        <FormField label="CTPS número">{campo("ctpsNumero")}</FormField>
        <FormField label="CTPS série / UF">
          <div className="documentos-registro__par">
            {campo("ctpsSerie", { placeholder: "Série" })}
            {campo("ctpsUf", { placeholder: "UF", maxLength: 2 })}
          </div>
        </FormField>
        <FormField label="CTPS emitida em">{campo("ctpsDataEmissao", { type: "date" })}</FormField>
        <FormField label="Opção pelo FGTS">{campo("fgtsDataOpcao", { type: "date" })}</FormField>
        <FormField label="Nº da ficha de registro">{campo("registroNumero")}</FormField>
        <FormField label="Matrícula eSocial">{campo("matriculaEsocial")}</FormField>
        <FormField label="CBO" hint="código do cargo na carteira">{campo("cbo", { maxLength: 6 })}</FormField>
        <FormField label="Jornada do contrato">
          <div className="documentos-registro__par">
            {campo("jornadaInicio", { type: "time" })}
            {campo("jornadaFim", { type: "time" })}
          </div>
        </FormField>
        <FormField label="Intervalo do contrato">
          <div className="documentos-registro__par">
            {campo("intervaloInicio", { type: "time" })}
            {campo("intervaloFim", { type: "time" })}
          </div>
        </FormField>
      </FormGrid>}
    </FormSection>
  );
}
