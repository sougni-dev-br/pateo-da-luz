import { useEffect, useRef, useState } from "react";
import { getAnaliseMetas, salvarAnaliseMeta, type AnaliseIndicadorDeMeta, type AnaliseMetas } from "../../api/client";
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
  const [gravando, setGravando] = useState(false);
  const escolhidoRef = useRef(escolhido);
  useEffect(() => {
    escolhidoRef.current = escolhido;
  }, [escolhido]);

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
    setGravando(true);
    try {
      const dados = await salvarAnaliseMeta({ ano: escolhido.ano, mes: escolhido.mes, indicador, valor });
      // Com a navegação travada durante a gravação isto não deveria acontecer, mas uma resposta de
      // outro mês nunca pode ocupar a tela.
      const atual = escolhidoRef.current;
      if (atual.ano === dados.mes.ano && atual.mes === dados.mes.mes) setEstado({ tipo: "ok", dados });
    } finally {
      setGravando(false);
    }
  }

  return (
    <MetasView
      mes={escolhido}
      dados={estado.tipo === "ok" ? estado.dados : null}
      carregando={estado.tipo === "carregando"}
      erro={estado.tipo === "erro" ? estado.mensagem : null}
      podeEditar={podeEditar}
      navegacaoBloqueada={gravando}
      onSalvar={salvar}
      onMesAnterior={() => mudarMes(-1)}
      onProximoMes={() => mudarMes(1)}
      onTentarDeNovo={() => setTentativa((n) => n + 1)}
    />
  );
}
