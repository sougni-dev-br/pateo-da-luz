import * as Dialogo from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PlanejamentoComentarioMetrica, PlanejamentoComentarioTurno, PlanejamentoComparativo } from "../../../api/client";
import { Alert, Button, Select } from "../../../design-system";
import { useConfirmacao } from "../Confirmacao";
import { NOMES_DOS_MESES } from "../formato";
import { useDialogoAcessivel } from "../useDialogoAcessivel";
import { useEstreito } from "../useEstreito";
import { useOculto } from "../useOculto";
import { ComentarioItem } from "./ComentarioItem";
import { FormularioDeComentario } from "./FormularioDeComentario";
import { numerosDoPonto } from "./formatoComentario";
import { chaveDoPonto, ROTULO_DA_METRICA, rotuloDoPonto, type PontoDeComentario } from "./ponto";
import type { ComentariosApi } from "./useComentarios";

// Gaveta à direita (tela inteira no celular) com os comentários de um ponto: lista, formulário e os seletores que
// trocam o ponto sem fechar. Radix Dialog cuida de foco preso, Esc e rótulos; useDialogoAcessivel devolve o foco.

type Props = {
  ponto: PontoDeComentario | null;
  aoMudarPonto: (ponto: PontoDeComentario) => void;
  aoFechar: () => void;
  dados: PlanejamentoComparativo;
  api: ComentariosApi;
  podeEscrever: boolean;
};

const OPCOES_DO_MES = [{ value: "0", label: "Ano inteiro" }, ...NOMES_DOS_MESES.map((nome, i) => ({ value: String(i + 1), label: nome.charAt(0).toUpperCase() + nome.slice(1) }))];
const OPCOES_DO_TURNO = [{ value: "TOTAL", label: "Total" }, { value: "ALMOCO", label: "Almoço" }, { value: "JANTAR", label: "Jantar" }];
const OPCOES_DA_METRICA = (Object.keys(ROTULO_DA_METRICA) as PlanejamentoComentarioMetrica[]).map((m) => ({ value: m, label: ROTULO_DA_METRICA[m] }));

function Seletores({ ponto, aoMudar }: { ponto: PontoDeComentario; aoMudar: (p: PontoDeComentario) => void }) {
  return (
    <div className="plan-coment-seletores">
      <Select label="Mês" value={String(ponto.mes ?? 0)} options={OPCOES_DO_MES} onChange={(e) => aoMudar({ ...ponto, mes: Number(e.target.value) || null })} />
      <Select label="Métrica" value={ponto.metrica} options={OPCOES_DA_METRICA} onChange={(e) => aoMudar({ ...ponto, metrica: e.target.value as PlanejamentoComentarioMetrica })} />
      <Select label="Turno" value={ponto.turno} options={OPCOES_DO_TURNO} onChange={(e) => aoMudar({ ...ponto, turno: e.target.value as PlanejamentoComentarioTurno })} />
    </div>
  );
}

function Numeros({ dados, ponto }: { dados: PlanejamentoComparativo; ponto: PontoDeComentario }) {
  const numeros = numerosDoPonto(dados, ponto, useOculto());
  if (!numeros) return <p className="plan-coment-numeros">Sem números neste ponto.</p>;
  return (
    <dl className="plan-coment-numeros">
      <div><dt>{dados.anoBase}</dt><dd>{numeros.base}</dd></div>
      <div><dt>{dados.anoComparado}</dt><dd>{numeros.comparado}</dd></div>
      <div><dt>Variação</dt><dd>{numeros.variacao}</dd></div>
    </dl>
  );
}

export function PainelDeComentarios({ ponto, aoMudarPonto, aoFechar, dados, api, podeEscrever }: Props) {
  const estreito = useEstreito();
  const { confirmar, dialogo } = useConfirmacao();
  const lista = useRef<HTMLUListElement>(null);
  const gaveta = useRef<HTMLDivElement>(null);
  const anterior = useRef({ chave: "", total: 0 });
  useDialogoAcessivel(ponto !== null);
  const chave = ponto ? chaveDoPonto(ponto) : "";
  const totalDoPonto = api.porPonto.get(chave)?.length ?? 0;
  // Se um comentário do mesmo ponto sumiu (apagado), o foco não pode cair no <body>: vai para a lista e, se ela
  // esvaziou, para a própria gaveta. Trocar de ponto só reinicia a contagem.
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = { chave, total: totalDoPonto };
    if (chave === "" || antes.chave !== chave || totalDoPonto >= antes.total) return;
    (lista.current ?? gaveta.current)?.focus();
  }, [chave, totalDoPonto]);
  if (!ponto) return null;
  const comentarios = api.porPonto.get(chaveDoPonto(ponto)) ?? [];
  const rotulo = rotuloDoPonto(ponto, dados.anoComparado);

  return (
    <Dialogo.Root open onOpenChange={(aberto) => { if (!aberto) aoFechar(); }}>
      <Dialogo.Portal>
        <Dialogo.Overlay className="radix-dialog-overlay" />
        <Dialogo.Content
          ref={gaveta}
          className={`plan-coment-gaveta plan-form-dialogo${estreito ? " plan-coment-gaveta-cheia" : ""}`}
          aria-describedby="plan-coment-numeros"
          onEscapeKeyDown={(e) => { if ((e.target as Element | null)?.closest?.("[data-comentario-editando]")) e.preventDefault(); }}
        >
          <div className="plan-coment-cabeca">
            <Dialogo.Title className="plan-coment-titulo">Comentários · {rotulo}</Dialogo.Title>
            <div id="plan-coment-numeros"><Numeros dados={dados} ponto={ponto} /></div>
            <Dialogo.Close className="plan-coment-fechar" aria-label="Fechar"><X size={20} aria-hidden /></Dialogo.Close>
          </div>
          <div className="plan-coment-corpo" aria-busy={api.carregando}>
            <Seletores ponto={ponto} aoMudar={aoMudarPonto} />
            {api.erro && (
              <Alert tone="error" role="alert" title="Os comentários não carregaram">
                {api.erro} Os números do comparativo continuam valendo.
                <span className="plan-salvar-acoes-alerta"><Button variant="secondary" onClick={api.recarregar}>Tentar de novo</Button></span>
              </Alert>
            )}
            {!api.erro && comentarios.length === 0 && !api.carregando && (
              <p className="plan-coment-vazio">Ninguém explicou este ponto ainda.{podeEscrever ? " Escreva abaixo o que aconteceu." : ""}</p>
            )}
            {comentarios.length > 0 && (
              <ul className="plan-coment-lista" ref={lista} tabIndex={-1} aria-label={`Comentários em ${rotulo}`}>
                {comentarios.map((c) => <ComentarioItem key={c.id} comentario={c} api={api} confirmar={confirmar} />)}
              </ul>
            )}
            {podeEscrever
              ? <FormularioDeComentario key={chaveDoPonto(ponto)} rotuloSalvar="Salvar comentário" aoSalvar={(texto, naImpressao) => api.criar(ponto, texto, naImpressao)} />
              : <p className="plan-coment-aviso">Você pode ler os comentários, mas escrever exige permissão de edição no Planejamento.</p>}
          </div>
          {dialogo}
        </Dialogo.Content>
      </Dialogo.Portal>
    </Dialogo.Root>
  );
}
