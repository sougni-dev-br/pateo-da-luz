import { useState } from "react";
import type { AnaliseMetaIndicador, AnaliseMetas } from "../../api/client";
import { Button, StatusBadge } from "../../design-system";
import { Barra } from "./Barra";
import { EditorDeMeta } from "./EditorDeMeta";
import { inteiro, percentual } from "./formato";
import { formatarValor, seloDaSituacao } from "./metaFormato";
import { useFormato } from "./useFormato";

type Props = {
  indicador: AnaliseMetaIndicador;
  mes: AnaliseMetas["mes"];
  diasRestantes: number;
  podeEditar: boolean;
  onSalvar: (valor: number | null) => Promise<void>;
};

const SOMAS = ["faturamento", "pessoas"] as const;

// Uma meta: onde o mês está, para onde o ritmo leva e o que falta. Só texto e número dizem se está
// bem; a cor do selo e da barra acompanham, não decidem sozinhas.
export function MetaCard({ indicador: i, mes, diasRestantes, podeEditar, onSalvar }: Props) {
  const { reais } = useFormato();
  const [editando, setEditando] = useState(false);
  const selo = seloDaSituacao(i);
  const ehSoma = (SOMAS as readonly string[]).includes(i.indicador);
  const valor = (n: number) => formatarValor(i.indicador, n, reais);
  const porDia = (n: number) => `${formatarValor(i.indicador, n, reais, true)} por dia`;

  return (
    <li className={`meta-card meta-${i.situacao}`}>
      <div className="meta-topo">
        <h3 className="meta-titulo">{i.rotulo}</h3>
        <StatusBadge tone={selo.tom}>{selo.texto}</StatusBadge>
      </div>

      <p className="meta-numero">
        <strong>{i.realizado === null ? "—" : valor(i.realizado)}</strong>
        {i.meta !== null && (
          <span className="meta-de">
            {i.menorEMelhor ? " · meta: até " : " · meta: "}
            {valor(i.meta)}
          </span>
        )}
      </p>

      {ehSoma && i.progresso !== null && <Barra razao={i.progresso} tom={i.situacao === "abaixo" ? "perigo" : "neutro"} />}

      <div className="meta-detalhes">{detalhes(i, mes, diasRestantes, valor, porDia)}</div>

      {i.referencia && (
        <p className="meta-referencia">
          Referência: média dos últimos {i.referencia.mesesNaMedia} meses <strong>{formatarValor(i.indicador, i.referencia.media3, reais, true)}</strong> · melhor mês{" "}
          <strong>{formatarValor(i.indicador, i.referencia.melhor, reais, true)}</strong>
        </p>
      )}

      {podeEditar && !editando && (
        <Button variant="secondary" size="sm" onClick={() => setEditando(true)}>
          {i.meta === null ? "Definir meta" : "Editar meta"}
        </Button>
      )}
      {podeEditar && editando && <EditorDeMeta indicador={i} onSalvar={onSalvar} onFechar={() => setEditando(false)} />}
    </li>
  );
}

function detalhes(i: AnaliseMetaIndicador, mes: AnaliseMetas["mes"], diasRestantes: number, valor: (n: number) => string, porDia: (n: number) => string) {
  if (i.meta === null) return <p>Defina uma meta para acompanhar o ritmo do mês.</p>;
  if (i.realizado === null) {
    return <p>{mes.futuro ? "O mês ainda não começou." : "Ainda faltam dias com venda para calcular esta taxa com segurança."}</p>;
  }

  if (i.indicador === "faturamento" || i.indicador === "pessoas") {
    const linhas: string[] = [];
    if (mes.encerrado) linhas.push(`Mês encerrado em ${valor(i.realizado)}, ${percentual(i.progresso ?? 0, 0)} da meta.`);
    else if (i.projecao !== null) linhas.push(`Ritmo atual leva o mês a ${valor(i.projecao)}, ${percentual(i.meta > 0 ? i.projecao / i.meta : 0, 0)} da meta.`);
    else linhas.push("Ainda sem histórico suficiente para projetar o fim do mês.");

    if (!mes.encerrado && i.faltam !== null && i.faltam > 0) {
      const necessario = i.porDiaNecessario !== null ? `: precisa de ${porDia(i.porDiaNecessario)} nos ${inteiro(diasRestantes)} dias que ainda abrem` : "";
      const atual = i.porDiaAtual !== null ? `; até aqui a média é ${porDia(i.porDiaAtual)}` : "";
      linhas.push(`Faltam ${valor(i.faltam)}${necessario}${atual}.`);
    }
    return (
      <>
        {linhas.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </>
    );
  }

  const comparacao = i.menorEMelhor ? "ficar em até" : "chegar a";
  return (
    <p>
      O mês está em {valor(i.realizado)}; a meta é {comparacao} {valor(i.meta)}.
    </p>
  );
}
