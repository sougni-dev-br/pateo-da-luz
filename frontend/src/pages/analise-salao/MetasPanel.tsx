import { useEffect, useRef, useState } from "react";
import { getAnaliseMetas, salvarAnaliseMeta, type AnaliseIndicadorDeMeta, type AnaliseMetas } from "../../api/client";
import { Alert, Button } from "../../design-system";
import { useSession } from "../../context/SessionContext";
import { hasPermission } from "../../lib/permissions";
import { MetasView } from "./MetasView";

type MesEscolhido = { ano: number; mes: number };
type Estado = { tipo: "carregando" } | { tipo: "ok"; dados: AnaliseMetas } | { tipo: "erro"; mensagem: string };

const ANO_MINIMO = 2020;
const ANO_MAXIMO = 2100;

function mesDe(data: Date): MesEscolhido {
  return { ano: data.getFullYear(), mes: data.getMonth() + 1 };
}

function somarMeses({ ano, mes }: MesEscolhido, delta: number): MesEscolhido {
  const indice = ano * 12 + (mes - 1) + delta;
  return { ano: Math.floor(indice / 12), mes: (indice % 12) + 1 };
}

// Container das metas: o mês é escolhido aqui e não depende do período do topo da tela.
export function MetasPanel() {
  const { user } = useSession();
  const podeEditar = hasPermission(user, "analise-salao", "edit");
  const [escolhido, setEscolhido] = useState<MesEscolhido>(() => mesDe(new Date()));
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  const escolhidoRef = useRef(escolhido);
  escolhidoRef.current = escolhido;

  useEffect(() => {
    const controller = new AbortController();
    setEstado({ tipo: "carregando" });
    getAnaliseMetas(escolhido.ano, escolhido.mes, controller.signal)
      .then((dados) => {
        if (!controller.signal.aborted) setEstado({ tipo: "ok", dados });
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setEstado({ tipo: "erro", mensagem: e instanceof Error ? e.message : "Não foi possível carregar as metas." });
      });
    return () => controller.abort();
  }, [escolhido.ano, escolhido.mes, tentativa]);

  function mudarMes(delta: number) {
    setEscolhido((atual) => {
      const novo = somarMeses(atual, delta);
      return novo.ano < ANO_MINIMO || novo.ano > ANO_MAXIMO ? atual : novo;
    });
  }

  async function salvar(indicador: AnaliseIndicadorDeMeta, valor: number | null) {
    const dados = await salvarAnaliseMeta({ ano: escolhido.ano, mes: escolhido.mes, indicador, valor });
    // Se a pessoa já foi para outro mês enquanto gravava, a resposta antiga não pode ocupar a tela.
    const atual = escolhidoRef.current;
    if (atual.ano === dados.mes.ano && atual.mes === dados.mes.mes) setEstado({ tipo: "ok", dados });
  }

  if (estado.tipo === "erro") {
    return (
      <Alert tone="error">
        {estado.mensagem}{" "}
        <Button variant="secondary" size="sm" onClick={() => setTentativa((n) => n + 1)}>
          Tentar de novo
        </Button>
      </Alert>
    );
  }
  if (estado.tipo === "carregando") return <p className="analise-nota">Carregando…</p>;

  return <MetasView dados={estado.dados} podeEditar={podeEditar} onSalvar={salvar} onMesAnterior={() => mudarMes(-1)} onProximoMes={() => mudarMes(1)} />;
}
