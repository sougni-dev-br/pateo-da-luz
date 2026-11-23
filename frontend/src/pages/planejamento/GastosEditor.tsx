import { History, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { PlanejamentoGrupoDeGasto, PlanejamentoLinhaDeGasto, PlanejamentoModoDoGasto } from "../../api/client";
import { Button, IconButton, Select, Table, TextField } from "../../design-system";
import { CampoNumerico } from "./CampoNumerico";
import { RealizadoDialog } from "./RealizadoDialog";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, reaisParaTexto, ROTULO_DO_GRUPO, textoParaPercentual, textoParaReais } from "./formato";

// Gastos do cenário, uma linha por tipo: valor fixo por mês (R$) ou % das vendas. A coluna "Todos" preenche
// os 12 meses de uma vez. A folha é informada TOTAL (com o serviço dentro); o serviço abate dela no resultado.

const MAXIMO_DE_LINHAS = 40;
const GRUPOS = Object.keys(ROTULO_DO_GRUPO) as PlanejamentoGrupoDeGasto[];
const OPCOES_DE_GRUPO = GRUPOS.map((g) => ({ value: g, label: ROTULO_DO_GRUPO[g] }));
const OPCOES_DE_MODO: { value: PlanejamentoModoDoGasto; label: string }[] = [
  { value: "FIXO", label: "Valor fixo (R$)" },
  { value: "PERCENTUAL", label: "% das vendas" }
];

/** Uma linha zerada por grupo; tributos nasce como % das vendas. Espelha o `linhasPadrao` do servidor. */
export function linhasPadraoDeGasto(): PlanejamentoLinhaDeGasto[] {
  return GRUPOS.map((grupo) => ({ grupo, nome: ROTULO_DO_GRUPO[grupo], modo: grupo === "TRIBUTOS" ? "PERCENTUAL" : "FIXO", valores: Array(12).fill(0) as number[] }));
}

const VALOR_MAXIMO_EM_REAIS = 1_000_000_000;
const dentroDoReal = (v: number) => v >= 0 && v <= VALOR_MAXIMO_EM_REAIS;
const dentroDoPercentual = (v: number) => v >= 0 && v <= 1;

type Props = {
  anoBase: number;
  gastos: PlanejamentoLinhaDeGasto[];
  servicoPercentual: number | null;
  desabilitado: boolean;
  onMudarGastos: (proximos: PlanejamentoLinhaDeGasto[]) => void;
  onMudarServico: (valor: number | null) => void;
};

export function GastosEditor({ anoBase, gastos, servicoPercentual, desabilitado, onMudarGastos, onMudarServico }: Props) {
  const [grupo, setGrupo] = useState<PlanejamentoGrupoDeGasto>("OUTROS");
  const [modo, setModo] = useState<PlanejamentoModoDoGasto>("FIXO");
  const [nome, setNome] = useState("");
  const [dialogoRealizado, setDialogoRealizado] = useState(false);

  const nomeJaExiste = gastos.some((g) => g.nome.trim().toLowerCase() === nome.trim().toLowerCase());
  const podeAdicionar = !desabilitado && nome.trim() !== "" && !nomeJaExiste && gastos.length < MAXIMO_DE_LINHAS;

  function mudarLinha(indice: number, mes: number | "todos", valor: number | null) {
    const novo = valor ?? 0;
    onMudarGastos(gastos.map((g, i) => (i !== indice ? g : { ...g, valores: g.valores.map((v, m) => (mes === "todos" || m === mes ? novo : v)) })));
  }

  function adicionar() {
    onMudarGastos([...gastos, { grupo, nome: nome.trim(), modo, valores: Array(12).fill(0) as number[] }]);
    setNome("");
  }

  const valorComum = (g: PlanejamentoLinhaDeGasto): number | null => (g.valores.every((v) => v === g.valores[0]) ? g.valores[0] : null);

  return (
    <div className="plan-gastos">
      {!desabilitado && (
        <div className="plan-barra">
          <Button variant="secondary" onClick={() => setDialogoRealizado(true)}><History size={16} aria-hidden /> Preencher com o realizado de {anoBase}</Button>
        </div>
      )}

      <div className="plan-servico">
        <span className="plan-servico-rotulo">Serviço sobre as vendas (%)</span>
        <CampoNumerico
          valor={servicoPercentual}
          rotulo="Serviço sobre as vendas, em %"
          desabilitado={desabilitado}
          aceitaVazio
          interpretar={textoParaPercentual}
          formatar={percentualParaTexto}
          valido={dentroDoPercentual}
          onMudar={onMudarServico}
        />
        <span className="plan-sub">Abate da folha informada abaixo (a folha é a total, com o serviço dentro). Vazio = não abater.</span>
      </div>

      {servicoPercentual !== null && servicoPercentual > 0 && !gastos.some((g) => g.grupo === "FOLHA") && (
        <p className="plan-sub">O serviço só abate de uma linha do grupo Folha de pagamento; sem ela, ele não muda o resultado.</p>
      )}

      <div className="plan-quadro plan-quadro-gastos">
        <Table aria-label="Gastos do cenário por mês">
          <Table.Head>
            <Table.Row>
              <Table.Th scope="col" className="plan-col-rotulo">Gasto</Table.Th>
              <Table.Th align="right">Todos</Table.Th>
              {NOMES_DOS_MESES_CURTOS.map((m) => <Table.Th key={m} align="right">{m}</Table.Th>)}
              <Table.Th align="right"><span className="plan-sr">Remover</span></Table.Th>
            </Table.Row>
          </Table.Head>
          <Table.Body>
            {gastos.map((g, i) => {
              const percentual = g.modo === "PERCENTUAL";
              const campo = (valor: number | null, rotulo: string, onMudar: (v: number | null) => void) => (
                <CampoNumerico
                  valor={valor}
                  rotulo={rotulo}
                  desabilitado={desabilitado}
                  interpretar={percentual ? textoParaPercentual : textoParaReais}
                  formatar={percentual ? percentualParaTexto : reaisParaTexto}
                  valido={percentual ? dentroDoPercentual : dentroDoReal}
                  largura={percentual ? 64 : 88}
                  onMudar={onMudar}
                />
              );
              return (
                <Table.Row key={g.nome}>
                  <Table.Th scope="row" className="plan-col-rotulo">
                    {g.nome}
                    <span className="plan-sub plan-gasto-meta">{ROTULO_DO_GRUPO[g.grupo]} · {percentual ? "% das vendas" : "R$ por mês"}</span>
                  </Table.Th>
                  <Table.Td align="right">{campo(valorComum(g), `${g.nome}, todos os meses`, (v) => mudarLinha(i, "todos", v))}</Table.Td>
                  {g.valores.map((valor, m) => (
                    <Table.Td key={m} align="right">{campo(valor, `${g.nome} em ${NOMES_DOS_MESES_CURTOS[m]}`, (v) => mudarLinha(i, m, v))}</Table.Td>
                  ))}
                  <Table.Td align="right">
                    {!desabilitado && <IconButton variant="danger" size="sm" icon={<Trash2 size={16} aria-hidden />} label={`Remover ${g.nome}`} onClick={() => onMudarGastos(gastos.filter((_, k) => k !== i))} />}
                  </Table.Td>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table>
      </div>

      <RealizadoDialog aberto={dialogoRealizado} anoBase={anoBase} gastos={gastos} onFechar={() => setDialogoRealizado(false)} onAplicar={onMudarGastos} />

      {!desabilitado && (
        <div className="plan-nova-linha">
          {gastos.length === 0 && <Button variant="secondary" onClick={() => onMudarGastos(linhasPadraoDeGasto())}>Usar as linhas padrão</Button>}
          <Select aria-label="Grupo do gasto" value={grupo} onChange={(e) => setGrupo(e.target.value as PlanejamentoGrupoDeGasto)} options={OPCOES_DE_GRUPO} containerClassName="plan-filtro" />
          <Select aria-label="Forma de cálculo" value={modo} onChange={(e) => setModo(e.target.value as PlanejamentoModoDoGasto)} options={OPCOES_DE_MODO} containerClassName="plan-filtro" />
          <TextField aria-label="Nome da nova linha de gasto" placeholder="Nome da nova linha" value={nome} maxLength={60} error={nomeJaExiste ? "Já existe uma linha com esse nome." : undefined} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && podeAdicionar) { e.preventDefault(); adicionar(); } }} />
          <Button variant="secondary" disabled={!podeAdicionar} onClick={adicionar}><Plus size={16} aria-hidden /> Adicionar linha</Button>
        </div>
      )}
    </div>
  );
}
