import { useCallback, useState } from "react";
import type { PlanejamentoPremissasDoMes, PlanejamentoProjecao } from "../../api/client";
import { Table } from "../../design-system";
import { NOMES_DOS_MESES_CURTOS, percentualParaTexto, textoDaVariacao } from "./formato";
import { AvisoComDesfazer } from "./AvisoComDesfazer";
import { PremissasCartoes } from "./PremissasCartoes";
import { CampoPercentual, COLUNAS, Efeito, type Coluna } from "./premissasCampos";
import { Quadro } from "./Quadro";
import { RitmoMensal } from "./RitmoDoAno";
import { useLargura } from "./useLargura";

// Premissas do cenário, uma linha por mês: crescimento de clientes e de ticket médio por turno (sobre o ano-base)
// e o % de CMV do mês. A linha "Todos os meses" só aplica no Enter (ou ao sair do campo): enquanto se digita, as
// células que vão mudar ficam marcadas e a linha diz quantas são; depois de aplicar, um aviso oferece desfazer.
// A última coluna mostra o efeito: as vendas do mês que essas premissas projetam, contra o ano-base. Acima, o "efeito
// no ano" redesenha as barras mês a mês a cada prévia. Abaixo da largura da tabela, cada mês vira um cartão.

/** Abaixo disso a tabela de 7 colunas não cabe sem rolar: cada mês vira um cartão. */
const LARGURA_DA_TABELA = 860;

/** As barras da variação das vendas, mês a mês, que estas premissas projetam contra o ano-base. */
function EfeitoNoAno({ projecao, anoBase }: { projecao: PlanejamentoProjecao | null | undefined; anoBase?: number }) {
  if (!projecao) return null;
  const meses = projecao.meses.map((m) => ({
    mes: m.mes,
    variacao: m.projetado && m.base && m.base.vendas.total > 0 ? m.projetado.vendas.total / m.base.vendas.total - 1 : null
  }));
  const total = projecao.total.variacaoVendas;
  return (
    <RitmoMensal
      className="plan-efeito-no-ano"
      titulo={`Efeito nas vendas, mês a mês${anoBase ? `, contra ${anoBase}` : ""}`}
      extra={<strong className={`plan-efeito-no-ano-total${total === null || total === 0 ? "" : total > 0 ? " plan-var-sobe" : " plan-var-desce"}`}>{textoDaVariacao(total)} no ano</strong>}
      meses={meses}
    />
  );
}

/** O que "Todos os meses" trocou: basta para desfazer só aquela coluna, sobre as premissas do momento. */
export type DesfazerTodos = { texto: string; coluna: Coluna; anteriores: (number | null)[] };

export function desfazerColuna(premissas: PlanejamentoPremissasDoMes[], aviso: DesfazerTodos): PlanejamentoPremissasDoMes[] {
  return premissas.map((p, i) => ({ ...p, [aviso.coluna]: aviso.anteriores[i] ?? null }));
}

type Props = {
  premissas: PlanejamentoPremissasDoMes[];
  desabilitado: boolean;
  onMudar: (proximas: PlanejamentoPremissasDoMes[]) => void;
  /** Para a coluna "Efeito" (vendas projetadas do mês). */
  projecao?: PlanejamentoProjecao | null;
  /** Quem mostra o aviso com "Desfazer" (a barra de salvar, para não cobrir a falha); sem ele, o aviso fica aqui. */
  onAvisoDeDesfazer?: (aviso: DesfazerTodos) => void;
  anoBase?: number;
};

export function PremissasEditor({ premissas, desabilitado, onMudar, projecao, onAvisoDeDesfazer, anoBase }: Props) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const [previa, setPrevia] = useState<{ coluna: Coluna; valor: number | null } | null>(null);
  const [desfazer, setDesfazer] = useState<DesfazerTodos | null>(null);
  const fecharDesfazer = useCallback(() => setDesfazer(null), []);

  function mudarMes(mes: number, coluna: Coluna, valor: number | null) {
    onMudar(premissas.map((p) => (p.mes === mes ? { ...p, [coluna]: valor } : p)));
  }

  function mudarTodos(coluna: Coluna, rotulo: string, valor: number | null) {
    const trocados = premissas.filter((p) => p[coluna] !== valor).length;
    if (trocados === 0) return;
    const anteriores = premissas.map((p) => p[coluna]);
    onMudar(premissas.map((p) => ({ ...p, [coluna]: valor })));
    const alvo = valor === null ? "vazio" : `${percentualParaTexto(valor)}%`;
    const aviso = { texto: `${rotulo}: ${trocados} ${trocados === 1 ? "mês trocado" : "meses trocados"} para ${alvo}.`, coluna, anteriores };
    if (onAvisoDeDesfazer) onAvisoDeDesfazer(aviso);
    else setDesfazer(aviso);
  }

  // O valor do "Todos" só aparece quando os 12 meses estão iguais; senão fica vazio para não mentir.
  const valorComum = (coluna: Coluna): number | null => {
    const primeiro = premissas[0]?.[coluna] ?? null;
    return premissas.every((p) => p[coluna] === primeiro) ? primeiro : null;
  };

  const vaiMudar = (p: PlanejamentoPremissasDoMes, coluna: Coluna) => previa !== null && previa.coluna === coluna && p[coluna] !== previa.valor;
  const quantosMudam = previa ? premissas.filter((p) => p[previa.coluna] !== previa.valor).length : 0;
  const dicaDoTodos = previa ? (quantosMudam > 0 ? `Enter troca ${quantosMudam} ${quantosMudam === 1 ? "mês" : "meses"} · Esc cancela` : "nada muda") : "aplica no Enter";
  const rotuloDe = (coluna: Coluna) => COLUNAS.find((c) => c.chave === coluna)?.rotulo ?? coluna;
  const preverTodos = (coluna: Coluna, v: number | null | undefined) => setPrevia(v === undefined ? null : { coluna, valor: v });

  const tabela = (
    <Quadro rotulo="Premissas do cenário por mês" editavel className="plan-quadro-estreito">
      <Table aria-label="Premissas do cenário por mês" className="plan-tabela-premissas">
        <Table.Head>
          <Table.Row>
            <Table.Th scope="col" className="plan-col-mes">Mês</Table.Th>
            {COLUNAS.map((c) => <Table.Th key={c.chave} align="right" title={c.ajuda}>{c.rotulo} %</Table.Th>)}
            <Table.Th align="right" className="plan-col-efeito" title="Vendas do mês com estas premissas, contra o mesmo mês do ano-base">Efeito: vendas</Table.Th>
          </Table.Row>
        </Table.Head>
        <Table.Body>
          <Table.Row className="plan-linha-todos">
            <Table.Th scope="row" className="plan-col-mes">
              Todos os meses
              <span className="plan-todos-dica" aria-live="polite">{dicaDoTodos}</span>
            </Table.Th>
            {COLUNAS.map((c) => (
              <Table.Td key={c.chave} align="right">
                <CampoPercentual
                  valor={valorComum(c.chave)}
                  rotulo={`${c.rotulo}, todos os meses`}
                  desabilitado={desabilitado}
                  aceitaVazio={c.chave === "cmv"}
                  adiado
                  onPrevia={(v) => preverTodos(c.chave, v)}
                  onMudar={(v) => mudarTodos(c.chave, c.rotulo, v)}
                />
              </Table.Td>
            ))}
            <Table.Td align="right" className="plan-col-efeito" />
          </Table.Row>
          {premissas.map((p) => (
            <Table.Row key={p.mes}>
              <Table.Th scope="row" className="plan-col-mes">{NOMES_DOS_MESES_CURTOS[p.mes - 1]}</Table.Th>
              {COLUNAS.map((c) => (
                <Table.Td key={c.chave} align="right">
                  <CampoPercentual valor={p[c.chave]} rotulo={`${c.rotulo} em ${NOMES_DOS_MESES_CURTOS[p.mes - 1]}`} desabilitado={desabilitado} aceitaVazio={c.chave === "cmv"} vaiMudar={vaiMudar(p, c.chave)} onMudar={(v) => mudarMes(p.mes, c.chave, v)} />
                </Table.Td>
              ))}
              <Table.Td align="right" className="plan-col-efeito"><Efeito projecao={projecao} mes={p.mes} /></Table.Td>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Quadro>
  );

  return (
    <div ref={ref} className="plan-premissas">
      <EfeitoNoAno projecao={projecao} anoBase={anoBase} />
      {largura >= LARGURA_DA_TABELA ? tabela : (
        <PremissasCartoes
          premissas={premissas}
          projecao={projecao}
          desabilitado={desabilitado}
          dicaDoTodos={dicaDoTodos}
          valorComum={valorComum}
          vaiMudar={vaiMudar}
          onPreviaDoTodos={preverTodos}
          onMudarTodos={(coluna, v) => mudarTodos(coluna, rotuloDe(coluna), v)}
          onMudarMes={mudarMes}
        />
      )}
      {desfazer && (
        <AvisoComDesfazer
          texto={desfazer.texto}
          onFechar={fecharDesfazer}
          onDesfazer={() => { onMudar(desfazerColuna(premissas, desfazer)); setDesfazer(null); }}
        />
      )}
    </div>
  );
}
