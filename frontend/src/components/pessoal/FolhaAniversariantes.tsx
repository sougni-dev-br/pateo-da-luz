import { Cake, PartyPopper } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { EmployeeBirthday } from "../../api/client";
import "./FolhaAniversariantes.css";

export type ModeloFolha = "CARTAZ" | "CARTOES" | "LISTA";
export type Orientacao = "portrait" | "landscape";
export type Paleta = "DOURADO" | "ROSA" | "AZUL" | "VERDE" | "PB";
export type FormaNome = "APELIDO" | "PRIMEIRO" | "COMPLETO";
export type TamanhoTexto = "PEQUENO" | "NORMAL" | "GRANDE";

export type OpcoesFolha = {
  modelo: ModeloFolha;
  orientacao: Orientacao;
  paleta: Paleta;
  formaNome: FormaNome;
  tamanho: TamanhoTexto;
  mostrarSetor: boolean;
  mostrarCargo: boolean;
  mostrarLogo: boolean;
  titulo: string;
  mensagem: string;
  assinatura: string;
};

// Dimensões da folha A4 em milímetros — a pré-visualização e a impressão usam as mesmas.
export const A4_MM = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } } as const;

const PALETAS: Record<Paleta, { acento: string; suave: string; tinta: string }> = {
  DOURADO: { acento: "#a8812f", suave: "#f7f0e1", tinta: "#1f1b14" },
  ROSA: { acento: "#c0457a", suave: "#fcebf2", tinta: "#2a1520" },
  AZUL: { acento: "#2d68ad", suave: "#e8f1fb", tinta: "#131d2b" },
  VERDE: { acento: "#3c8657", suave: "#e8f4ec", tinta: "#14231a" },
  PB: { acento: "#111111", suave: "#ffffff", tinta: "#111111" }
};

const FATOR_TAMANHO: Record<TamanhoTexto, number> = { PEQUENO: 0.82, NORMAL: 1, GRANDE: 1.2 };
// Se o conteúdo não couber (nome comprido, mensagem longa), a letra encolhe nesse passo até caber.
const PASSO_AJUSTE = 0.93;
const AJUSTE_MINIMO = 0.35;
const TITULO_LONGO = 18;

function colunasDoCartaz(qtd: number, orientacao: Orientacao) {
  return qtd > (orientacao === "portrait" ? 8 : 3) ? 2 : 1;
}
function colunasDosCartoes(qtd: number, orientacao: Orientacao) {
  const limites = orientacao === "portrait" ? [1, 4, 9, 16] : [1, 2, 6, 12, 20];
  const i = limites.findIndex((lim) => qtd <= lim);
  return i === -1 ? limites.length + 1 : i + 1;
}
// Lista: divide em duas colunas quando, numa só, a letra ficaria pequena demais.
function colunasDaLista(qtd: number, orientacao: Orientacao) {
  return ALTURA_UTIL_MM[orientacao] / (qtd * ALTURA_BASE_MM.LISTA) < 0.6 ? 2 : 1;
}

// Estimativa da altura útil (mm) do miolo; o ajuste medido corrige o que a estimativa errar.
const ALTURA_UTIL_MM = { portrait: 165, landscape: 88 } as const;
// Altura de uma linha/cartão (mm) quando o fator de tamanho é 1; o espaço entre cartões não escala.
const ALTURA_BASE_MM: Record<ModeloFolha, number> = { CARTAZ: 28, CARTOES: 54, LISTA: 13 };
const ESPACO_CARTOES_MM = 6;
const FATOR_MAXIMO: Record<ModeloFolha, number> = { CARTAZ: 1.4, CARTOES: 1.5, LISTA: 1.3 };

function colunasDoModelo(qtd: number, modelo: ModeloFolha, orientacao: Orientacao) {
  if (modelo === "CARTAZ") return colunasDoCartaz(qtd, orientacao);
  if (modelo === "CARTOES") return colunasDosCartoes(qtd, orientacao);
  return colunasDaLista(qtd, orientacao);
}

// Quanto mais gente no mês, menor a letra — para caber tudo numa página.
function fatorPorQuantidade(qtd: number, modelo: ModeloFolha, orientacao: Orientacao) {
  const linhas = Math.ceil(Math.max(qtd, 1) / colunasDoModelo(qtd, modelo, orientacao));
  const espacos = modelo === "CARTOES" ? (linhas - 1) * ESPACO_CARTOES_MM : 0;
  const fator = (ALTURA_UTIL_MM[orientacao] - espacos) / (linhas * ALTURA_BASE_MM[modelo]);
  return Math.min(FATOR_MAXIMO[modelo], fator);
}

export function primeiroNome(b: EmployeeBirthday) {
  return (b.firstName ?? "").trim().split(/\s+/)[0] ?? "";
}

export function nomeParaExibir(b: EmployeeBirthday, forma: FormaNome) {
  if (forma === "COMPLETO") return `${b.firstName} ${b.lastName}`.trim();
  if (forma === "APELIDO") return (b.displayName ?? "").trim() || primeiroNome(b);
  return primeiroNome(b);
}

function dia(b: EmployeeBirthday) {
  return b.birthDate.slice(8, 10);
}

function detalhe(b: EmployeeBirthday, op: OpcoesFolha) {
  return [op.mostrarSetor ? b.sector : null, op.mostrarCargo ? b.position : null]
    .map((p) => (p ?? "").trim())
    .filter((p) => p !== "")
    .join(" · ");
}

// Encolhe a letra até o conteúdo caber na folha; recomeça do zero quando as opções mudam.
function useAjusteParaCaber(chave: string) {
  const ref = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState({ chave, valor: 1 });
  const valor = estado.chave === chave ? estado.valor : 1;
  const verificarRef = useRef(() => {});
  verificarRef.current = () => {
    const el = ref.current;
    if (el && el.scrollHeight > el.clientHeight + 1 && valor > AJUSTE_MINIMO) {
      setEstado({ chave, valor: valor * PASSO_AJUSTE });
    }
  };

  useLayoutEffect(() => {
    verificarRef.current();
    // Fonte e logo podem terminar de carregar depois do desenho e aumentar a altura: mede de novo quando o conteúdo muda de tamanho.
    const el = ref.current;
    if (!el) return;
    const observador = new ResizeObserver(() => verificarRef.current());
    Array.from(el.children).forEach((filho) => observador.observe(filho));
    return () => observador.disconnect();
  });

  return { ref, valor };
}

type Props = { pessoas: EmployeeBirthday[]; opcoes: OpcoesFolha; nomeMes: string };

export function FolhaAniversariantes({ pessoas, opcoes, nomeMes }: Props) {
  const { ref, valor: ajuste } = useAjusteParaCaber(JSON.stringify([pessoas.map((p) => p.id), opcoes, nomeMes]));
  const dim = A4_MM[opcoes.orientacao];
  const cores = PALETAS[opcoes.paleta];
  const k = fatorPorQuantidade(pessoas.length, opcoes.modelo, opcoes.orientacao) * FATOR_TAMANHO[opcoes.tamanho] * ajuste;
  const tituloProprio = opcoes.titulo.trim();
  const titulo = tituloProprio || nomeMes;
  const estilo = {
    width: `${dim.w}mm`,
    height: `${dim.h}mm`,
    "--folha-h": `${dim.h}mm`,
    "--acento": cores.acento,
    "--suave": cores.suave,
    "--tinta": cores.tinta,
    "--k": k,
    "--ajuste": ajuste
  } as CSSProperties;
  const classes = [
    "aniv-folha",
    `aniv-folha--${opcoes.modelo.toLowerCase()}`,
    `aniv-folha--${opcoes.orientacao}`,
    opcoes.paleta === "PB" && "aniv-folha--pb"
  ].filter(Boolean).join(" ");

  return (
    <div ref={ref} className={classes} style={estilo}>
      {opcoes.modelo === "CARTAZ" && <div className="aniv-bandeirinhas" aria-hidden="true" />}
      {opcoes.modelo === "CARTAZ" && <div className="aniv-confete" aria-hidden="true" />}

      <header className="aniv-cabecalho">
        {opcoes.mostrarLogo && <img className="aniv-logo" src="/logo-pateo-luz.png" alt="Pateo da Luz" />}
        <span className="aniv-sobretitulo">
          <Cake aria-hidden="true" /> {tituloProprio ? "Feliz aniversário" : "Aniversariantes de"}
        </span>
        <h1 className={`aniv-titulo${titulo.length > TITULO_LONGO ? " aniv-titulo--longo" : ""}`}>{titulo}</h1>
        {opcoes.mensagem.trim() && <p className="aniv-mensagem">{opcoes.mensagem}</p>}
      </header>

      {pessoas.length === 0 ? (
        <p className="aniv-vazio">Nenhum aniversariante selecionado.</p>
      ) : opcoes.modelo === "LISTA" ? (
        <ListaModelo pessoas={pessoas} opcoes={opcoes} />
      ) : opcoes.modelo === "CARTOES" ? (
        <CartoesModelo pessoas={pessoas} opcoes={opcoes} />
      ) : (
        <CartazModelo pessoas={pessoas} opcoes={opcoes} />
      )}

      <footer className="aniv-rodape">
        {opcoes.modelo === "CARTAZ" && (
          <span className="aniv-parabens" aria-hidden="true">
            <PartyPopper /> Parabéns! <PartyPopper className="aniv-espelhado" />
          </span>
        )}
        {opcoes.assinatura.trim() && <span className="aniv-assinatura">{opcoes.assinatura}</span>}
      </footer>
    </div>
  );
}

type ModeloProps = { pessoas: EmployeeBirthday[]; opcoes: OpcoesFolha };

function CartazModelo({ pessoas, opcoes }: ModeloProps) {
  const duasColunas = colunasDoCartaz(pessoas.length, opcoes.orientacao) === 2;
  return (
    <ol className={`aniv-cartaz-lista${duasColunas ? " aniv-cartaz-lista--2col" : ""}`}>
      {pessoas.map((b) => {
        const extra = detalhe(b, opcoes);
        return (
          <li key={b.id} className="aniv-cartaz-item">
            <span className="aniv-dia"><small>dia</small>{dia(b)}</span>
            <span className="aniv-cartaz-texto">
              <strong>{nomeParaExibir(b, opcoes.formaNome)}</strong>
              {extra && <em>{extra}</em>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CartoesModelo({ pessoas, opcoes }: ModeloProps) {
  const colunas = colunasDosCartoes(pessoas.length, opcoes.orientacao);
  return (
    <div className="aniv-cartoes" style={{ gridTemplateColumns: `repeat(${colunas}, 1fr)` }}>
      {pessoas.map((b) => {
        const extra = detalhe(b, opcoes);
        return (
          <div key={b.id} className="aniv-cartao">
            <Cake className="aniv-cartao-icone" aria-hidden="true" />
            <span className="aniv-cartao-dia">{dia(b)}</span>
            <strong>{nomeParaExibir(b, opcoes.formaNome)}</strong>
            {extra && <em>{extra}</em>}
          </div>
        );
      })}
    </div>
  );
}

function ListaModelo({ pessoas, opcoes }: ModeloProps) {
  const colunas = colunasDaLista(pessoas.length, opcoes.orientacao);
  const porColuna = Math.ceil(pessoas.length / colunas);
  const blocos = Array.from({ length: colunas }, (_, i) => pessoas.slice(i * porColuna, (i + 1) * porColuna));
  return (
    <div className="aniv-tabelas" style={{ gridTemplateColumns: `repeat(${colunas}, 1fr)` }}>
      {blocos.map((bloco, i) => (
        <table key={i} className="aniv-tabela">
          <thead>
            <tr>
              <th>Dia</th>
              <th>Nome</th>
              {opcoes.mostrarSetor && <th>Setor</th>}
              {opcoes.mostrarCargo && <th>Cargo</th>}
            </tr>
          </thead>
          <tbody>
            {bloco.map((b) => (
              <tr key={b.id}>
                <td className="aniv-tabela-dia">{dia(b)}</td>
                <td className="aniv-tabela-nome">{nomeParaExibir(b, opcoes.formaNome)}</td>
                {opcoes.mostrarSetor && <td>{b.sector ?? "—"}</td>}
                {opcoes.mostrarCargo && <td>{b.position ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
