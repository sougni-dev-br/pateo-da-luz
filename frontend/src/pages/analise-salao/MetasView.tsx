import type { AnaliseIndicadorDeMeta, AnaliseMetas } from "../../api/client";
import { IconButton } from "../../design-system";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MetaCard } from "./MetaCard";
import { inteiro, nomeDoMes } from "./formato";

type Props = {
  dados: AnaliseMetas;
  podeEditar: boolean;
  onSalvar: (indicador: AnaliseIndicadorDeMeta, valor: number | null) => Promise<void>;
  onMesAnterior: () => void;
  onProximoMes: () => void;
};

// Metas do mês: navegação de mês + um cartão por indicador. Presentacional: quem busca e grava é o MetasPanel.
export function MetasView({ dados, podeEditar, onSalvar, onMesAnterior, onProximoMes }: Props) {
  const { mes, cobertura, indicadores } = dados;
  const temMeta = indicadores.some((i) => i.meta !== null);
  const nome = nomeDoMes(mes.mes, mes.ano);

  return (
    <div className="analise-stack">
      <div className="metas-navegacao">
        <IconButton icon={<ChevronLeft size={18} aria-hidden />} label="Mês anterior" onClick={onMesAnterior} />
        <h2 className="metas-mes" aria-live="polite">
          {nome}
        </h2>
        <IconButton icon={<ChevronRight size={18} aria-hidden />} label="Próximo mês" onClick={onProximoMes} />
      </div>

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
            : `Nenhuma meta definida para ${nome}. Quem edita metas pode defini-las aqui.`}
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
    </div>
  );
}
