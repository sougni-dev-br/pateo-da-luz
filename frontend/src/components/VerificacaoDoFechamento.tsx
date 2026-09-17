// O que o sistema confere antes de um mês virar CMV.
//
// Cada verificação aqui existe porque o erro correspondente passou meses
// despercebido e só apareceu numa auditoria manual: mês apurando com estoque de
// abertura zero, um terço dos itens valendo R$ 0,00, o custo da caixa aplicado a
// cada unidade contada.
//
// A tela mostra o número ao lado do achado de propósito. "Há itens sem custo"
// não faz ninguém abrir nada; "400 caixas de pizza valendo R$ 0,00" faz.

import { AlertTriangle, CheckCircle2, ChevronDown, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { getVerificacaoDoFechamento, type AchadoDoFechamento, type VerificacaoDoFechamento as Dados } from "../api/client";
import { Alert } from "../design-system";
import "./VerificacaoDoFechamento.css";

type Props = {
  /** Competência a conferir. Nulo enquanto nenhum período está selecionado. */
  year: number | null;
  month: number | null;
};

function Achado({ achado }: { achado: AchadoDoFechamento }) {
  const [aberto, setAberto] = useState(achado.severidade === "BLOQUEIO");
  const bloqueio = achado.severidade === "BLOQUEIO";

  return (
    <li className={`verif-achado${bloqueio ? " verif-achado-bloqueio" : ""}`}>
      <button
        type="button"
        className="verif-achado-topo"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
      >
        <span className="verif-achado-icone">
          {bloqueio ? <ShieldAlert size={16} /> : <AlertTriangle size={16} />}
        </span>
        <span className="verif-achado-titulo">{achado.titulo}</span>
        <ChevronDown size={16} className={`verif-achado-seta${aberto ? " aberta" : ""}`} />
      </button>

      {aberto && (
        <div className="verif-achado-corpo">
          <p className="verif-achado-detalhe">{achado.detalhe}</p>
          {achado.exemplos.length > 0 && (
            <ul className="verif-exemplos">
              {achado.exemplos.map((ex, i) => (
                <li key={`${ex.produto}-${i}`}>
                  <span className="verif-exemplo-produto">{ex.produto}</span>
                  <span className="verif-exemplo-numero">{ex.numero}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function VerificacaoDoFechamento({ year, month }: Props) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (year == null || month == null) {
      setDados(null);
      return;
    }
    let ativo = true;
    setCarregando(true);
    setErro(null);
    getVerificacaoDoFechamento(year, month)
      .then((r) => { if (ativo) setDados(r); })
      .catch((e) => { if (ativo) setErro(e instanceof Error ? e.message : "Não foi possível conferir o fechamento."); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [year, month]);

  if (year == null || month == null) return null;
  if (carregando) return <p className="verif-estado">Conferindo o fechamento…</p>;
  if (erro) return <Alert tone="warning">{erro}</Alert>;
  if (!dados) return null;

  // Sem inventário final o mês nem começou a fechar: cobrar aqui seria ruído.
  if (!dados.temInventarioFinal) {
    return <p className="verif-estado">Ainda não há inventário final para {String(month).padStart(2, "0")}/{year}.</p>;
  }

  if (dados.achados.length === 0) {
    return (
      <Alert tone="success">
        Conferência sem apontamentos: a cadeia está encadeada, todo item contado tem custo
        e nenhum destoa da própria série.
      </Alert>
    );
  }

  const bloqueios = dados.achados.filter((a) => a.severidade === "BLOQUEIO");

  return (
    <section className="verif-painel">
      <header className="verif-cabecalho">
        <span className="verif-cabecalho-icone">
          {dados.podeAprovar ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
        </span>
        <div>
          <h3>Conferência do fechamento</h3>
          <p>
            {bloqueios.length > 0
              ? `${bloqueios.length} ${bloqueios.length === 1 ? "impedimento" : "impedimentos"} e ${dados.achados.length - bloqueios.length} ${dados.achados.length - bloqueios.length === 1 ? "ponto de atenção" : "pontos de atenção"}.`
              : `${dados.achados.length} ${dados.achados.length === 1 ? "ponto de atenção" : "pontos de atenção"}. Nada impede fechar.`}
          </p>
        </div>
      </header>

      <ul className="verif-lista">
        {dados.achados.map((a) => <Achado key={a.codigo} achado={a} />)}
      </ul>
    </section>
  );
}
