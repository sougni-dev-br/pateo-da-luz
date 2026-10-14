import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AnaliseIndicadorDeMeta, AnaliseMetas } from "../../api/client";
import { Alert, Button, IconButton } from "../../design-system";
import { MetaCard } from "./MetaCard";
import { inteiro, nomeDoMes } from "./formato";

type Props = {
  // O mês escolhido: a navegação e o título dependem dele, não de a resposta já ter chegado.
  mes: { ano: number; mes: number };
  dados: AnaliseMetas | null;
  carregando: boolean;
  erro: string | null;
  podeEditar: boolean;
  // Durante uma gravação o mês não troca: a resposta (ou a falha) tem que cair no mês certo.
  navegacaoBloqueada: boolean;
  onSalvar: (indicador: AnaliseIndicadorDeMeta, valor: number | null) => Promise<void>;
  onMesAnterior: () => void;
  onProximoMes: () => void;
  onTentarDeNovo: () => void;
};

// Metas do mês: navegação de mês sempre montada + um cartão por indicador. Presentacional: quem
// busca e grava é o MetasPanel.
export function MetasView({ mes, dados, carregando, erro, podeEditar, navegacaoBloqueada, onSalvar, onMesAnterior, onProximoMes, onTentarDeNovo }: Props) {
  const nome = nomeDoMes(mes.mes, mes.ano);

  return (
    <div className="analise-stack">
      <div className="metas-navegacao">
        <IconButton icon={<ChevronLeft size={18} aria-hidden />} label="Mês anterior" onClick={onMesAnterior} disabled={navegacaoBloqueada} />
        <h2 className="metas-mes" aria-live="polite">
          {nome}
        </h2>
        <IconButton icon={<ChevronRight size={18} aria-hidden />} label="Próximo mês" onClick={onProximoMes} disabled={navegacaoBloqueada} />
      </div>

      {erro ? (
        <Alert tone="error">
          {erro}{" "}
          <Button variant="secondary" size="sm" onClick={onTentarDeNovo}>
            Tentar de novo
          </Button>
        </Alert>
      ) : carregando || !dados ? (
        <p className="analise-nota" role="status">
          Carregando…
        </p>
      ) : (
        <Conteudo key={`${dados.mes.ano}-${dados.mes.mes}`} dados={dados} nome={nome} podeEditar={podeEditar} onSalvar={onSalvar} />
      )}
    </div>
  );
}

function Conteudo({ dados, nome, podeEditar, onSalvar }: { dados: AnaliseMetas; nome: string; podeEditar: boolean; onSalvar: Props["onSalvar"] }) {
  const { mes, cobertura, indicadores } = dados;
  const temMeta = indicadores.some((i) => i.meta !== null);

  return (
    <>
      <p className="analise-contexto">
        {mes.futuro ? (
          <>Mês ainda por vir.</>
        ) : (
          <>
            <strong>{inteiro(cobertura.diasComMovimento)}</strong> {cobertura.diasComMovimento === 1 ? "dia fechado" : "dias fechados"} com venda
            {mes.encerrado ? "." : <> e <strong>{inteiro(cobertura.diasRestantes)}</strong> {cobertura.diasRestantes === 1 ? "dia" : "dias"} ainda por abrir, hoje incluído.</>}
          </>
        )}{" "}
        O ritmo vem da média de cada dia da semana nas últimas 8 semanas, só nos dias que costumam abrir. É uma estimativa, não uma garantia.
      </p>

      {!temMeta && (
        <p className="analise-nota">
          {podeEditar
            ? `Nenhuma meta definida para ${nome}. Em cada indicador, "Definir meta" já sugere a média dos últimos meses e o melhor mês como ponto de partida.`
            : `Nenhuma meta definida para ${nome}.`}
        </p>
      )}

      <ul className="metas-grade">
        {indicadores.map((i) => (
          <MetaCard
            key={i.indicador}
            indicador={i}
            mes={mes}
            diasRestantes={cobertura.diasRestantes}
            podeEditar={podeEditar}
            onSalvar={(valor) => onSalvar(i.indicador, valor)}
          />
        ))}
      </ul>
    </>
  );
}
