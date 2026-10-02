// Nova rescisão / abrir rescisão: quatro passos com o que lembrar em cada um.
//   1. Funcionário e data de saída   2. O que o sistema apurou (ou o termo, CLT)
//   3. Pendências antes de lançar     4. Conferir e lançar no Contas a Pagar
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type DetalheRescisao, type ListaRescisoes, type TerminationInfo,
  getRescisaoDetalhe, getTerminationInfo,
} from "../../../api/client";
import { Alert, Button, StatusBadge } from "../../../design-system";
import { pendenciasDaRescisao } from "./pendencias";
import { PassoApuracao } from "./PassoApuracao";
import { PassoFuncionario } from "./PassoFuncionario";
import { PassoLancar } from "./PassoLancar";
import { PassoPendencias } from "./PassoPendencias";
import { situacaoRescisao } from "./situacao";

export type NumeroPasso = 1 | 2 | 3 | 4;
const PASSOS: Array<{ n: NumeroPasso; rotulo: string }> = [
  { n: 1, rotulo: "Funcionário e saída" },
  { n: 2, rotulo: "Apuração" },
  { n: 3, rotulo: "Pendências" },
  { n: 4, rotulo: "Conferir e lançar" },
];
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

type Props = {
  employeeId: string | null;
  passo: NumeroPasso;
  lista: ListaRescisoes | null;
  onEscolher: (employeeId: string) => void;
  onPasso: (n: NumeroPasso) => void;
  onVoltar: () => void;
  onMudou: () => void;
};

export function AssistenteRescisao({ employeeId, passo, lista, onEscolher, onPasso, onVoltar, onMudou }: Props) {
  const [detalhe, setDetalhe] = useState<DetalheRescisao | null>(null);
  const [info, setInfo] = useState<TerminationInfo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  // Trocou de pessoa com a carga no ar: a resposta da anterior não vale mais.
  const pessoaAtual = useRef(employeeId);
  pessoaAtual.current = employeeId;

  const recarregar = useCallback(async () => {
    // Sem pessoa: nada a carregar, e a carga que estava no ar (de quem saiu) não pode deixar
    // o "carregando" preso — o finally dela já não mexe no estado.
    if (!employeeId) { setCarregando(false); setErro(null); return; }
    const desta = () => pessoaAtual.current === employeeId;
    setCarregando(true);
    setErro(null);
    try {
      const [d, i] = await Promise.all([getRescisaoDetalhe(employeeId), getTerminationInfo(employeeId)]);
      if (!desta()) return;
      setDetalhe(d);
      setInfo(i);
    } catch (e) {
      if (!desta()) return;
      setErro(e instanceof Error ? e.message : "Não consegui carregar a rescisão.");
    } finally {
      if (desta()) setCarregando(false);
    }
  }, [employeeId]);

  useEffect(() => {
    setDetalhe(null);
    setInfo(null);
    void recarregar();
  }, [recarregar]);

  // Troca de passo: o foco vai para o título do passo (leitor de tela e teclado acompanham).
  useEffect(() => { tituloRef.current?.focus(); }, [passo, employeeId]);

  const mudou = useCallback(() => { void recarregar(); onMudou(); }, [recarregar, onMudou]);

  // Só vale o detalhe da pessoa escolhida (nunca o de quem estava antes).
  const detalheAtual = detalhe && detalhe.pessoa.employeeId === employeeId ? detalhe : null;
  const pendencias = useMemo(
    () => (detalheAtual ? pendenciasDaRescisao({ detalhe: detalheAtual, apuracao: info?.apuracao ?? null }) : []),
    [detalheAtual, info],
  );
  const pessoa = detalheAtual ? detalheAtual.pessoa : null;
  const situacao = pessoa && lista ? situacaoRescisao(pessoa, lista.hoje) : null;
  const semSaida = pessoa != null && !pessoa.saida;
  const bloqueado = (n: NumeroPasso) => n > 1 && (!employeeId || semSaida);
  const paraAcao = pendencias.filter((p) => p.tom === "acao").length;

  return (
    <div className="rr-corpo">
      <div className="rr-cabeca-pessoa">
        <div>
          <Button variant="secondary" size="sm" leadingIcon={<ArrowLeft size={14} />} onClick={onVoltar}>Voltar às rescisões</Button>
          <h2 ref={tituloRef} tabIndex={-1} style={{ marginTop: 6 }}>
            {pessoa ? pessoa.nome : "Nova rescisão"}
            <span className="rr-sr-only"> — passo {passo} de 4: {PASSOS[passo - 1].rotulo}</span>
          </h2>
          {pessoa && (
            <div className="rr-selos">
              <StatusBadge tone={pessoa.semRegistro ? "warning" : "neutral"}>{pessoa.semRegistro ? "Sem registro: apurada aqui" : "CLT: bruto da contabilidade"}</StatusBadge>
              {pessoa.empresa && <StatusBadge tone="neutral">{pessoa.empresa}</StatusBadge>}
              {pessoa.saida && <StatusBadge tone="neutral">Saída {dataBr(pessoa.saida)}</StatusBadge>}
              {situacao && <StatusBadge tone={situacao.tom}>{situacao.rotulo}</StatusBadge>}
            </div>
          )}
        </div>
      </div>

      <nav aria-label="Passos da rescisão">
        <ol className="rr-passos">
          {PASSOS.map((p) => (
            <li key={p.n}>
              <button
                type="button"
                className={`rr-passo${p.n < passo ? " rr-passo--feito" : ""}`}
                aria-current={p.n === passo ? "step" : undefined}
                disabled={bloqueado(p.n)}
                onClick={() => onPasso(p.n)}
              >
                <span className="rr-passo-num" aria-hidden="true">{p.n}</span>
                <span>{p.rotulo}{p.n === 3 && paraAcao > 0 ? ` (${paraAcao})` : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {erro && (
        <Alert tone="error">
          {erro} <Button size="sm" variant="secondary" onClick={() => void recarregar()}>Tentar de novo</Button>
        </Alert>
      )}
      {carregando && !detalhe && <p className="rr-ajuda">Carregando a rescisão…</p>}

      {passo === 1 && (
        <PassoFuncionario lista={lista} detalhe={detalhe} carregando={carregando} onEscolher={onEscolher} onGravou={mudou} onContinuar={() => onPasso(2)} />
      )}
      {passo === 2 && detalhe && (
        <PassoApuracao detalhe={detalhe} info={info} carregando={carregando} onMudou={mudou} onLancarNormal={() => onPasso(4)} />
      )}
      {passo === 3 && detalheAtual && (
        <PassoPendencias pendencias={pendencias} onMudou={mudou} onPasso={onPasso} />
      )}
      {passo > 1 && semSaida && (
        <Alert tone="warning">
          Sem data de saída: informe a data no passo 1 antes de apurar, conferir e lançar.{" "}
          <Button size="sm" variant="secondary" onClick={() => onPasso(1)}>Ir para o passo 1</Button>
        </Alert>
      )}
      {passo === 4 && detalhe && pessoa?.saida && (
        <PassoLancar
          key={`${pessoa.employeeId}-${pessoa.saida}`}
          funcionario={{ id: pessoa.employeeId, nome: pessoa.nome, semRegistro: info?.apuracao?.semRegistro ?? pessoa.semRegistro }}
          termo={pessoa.termo}
          pendenciasParaAcao={paraAcao}
          quitadaNoTermo={Boolean(pessoa.rescisao?.quitadaNoTermo)}
          onPasso={onPasso}
          onGravou={mudou}
        />
      )}

      {/* No passo 1 o próprio formulário grava e avança. */}
      {detalhe && !semSaida && passo > 1 && (
        <div className="rr-navegacao">
          <Button variant="secondary" leadingIcon={<ArrowLeft size={14} />} onClick={() => onPasso((passo - 1) as NumeroPasso)}>Passo anterior</Button>
          {passo < 4 && (
            <Button onClick={() => onPasso((passo + 1) as NumeroPasso)}>
              Próximo: {PASSOS[passo].rotulo} <ArrowRight size={14} aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
