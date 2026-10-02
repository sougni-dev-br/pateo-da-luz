// Primeira tela do link: carta de apresentação do Pateo da Luz explicando por que os dados são
// pedidos, o que ter em mãos e como eles são tratados. Só depois vem o formulário (ou a
// confirmação de identidade, quando a ficha já tem dados salvos).
import { ArrowRight, CalendarClock, Clock3, FileCheck2, ShieldCheck } from "lucide-react";

type Props = {
  tipo: "ADMISSAO" | "ATUALIZACAO";
  /** Só vem depois da verificação — antes dela, a carta não diz de quem é a ficha. */
  primeiroNome?: string;
  expiraEm?: string;
  jaComecou: boolean;
  onIniciar: () => void;
};

const DOCUMENTOS_ADMISSAO = [
  "Uma foto sua, de rosto — pode ser uma selfie tirada na hora",
  "Documento com foto (RG ou CNH) e CPF",
  "Carteira de trabalho — física ou digital — e número do PIS",
  "Título de eleitor",
  "Comprovante de endereço dos últimos 3 meses",
  "Certidão de casamento e documentos dos filhos, se houver",
];

const dataLonga = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "long" });

export function Apresentacao({ tipo, primeiroNome, expiraEm, jaComecou, onIniciar }: Props) {
  const admissao = tipo === "ADMISSAO";
  const saudacao = primeiroNome ? `Prezado(a) ${primeiroNome},` : "Prezado(a) colaborador(a),";
  return (
    <article className="fp-carta" aria-labelledby="fp-carta-titulo">
      <p className="fp-carta-selo">{admissao ? "Admissão" : "Atualização cadastral"}</p>
      <h1 id="fp-carta-titulo" className="fp-carta-titulo">
        {admissao ? "Ficha cadastral de admissão" : "Atualização dos seus dados cadastrais"}
      </h1>

      <div className="fp-carta-texto">
        <p>{saudacao}</p>
        {admissao ? (
          <>
            <p>Seja bem-vindo(a) à equipe do <strong>Pateo da Luz</strong>.</p>
            <p>
              Para formalizarmos o seu registro junto à nossa contabilidade, solicitamos o preenchimento desta
              ficha cadastral e o envio das fotos dos documentos indicados abaixo.
            </p>
          </>
        ) : (
          <p>
            O <strong>Pateo da Luz</strong> está atualizando o cadastro da equipe. Pedimos que confira os dados que
            já temos, corrija o que tiver mudado e, se for o caso, envie as fotos dos documentos novos.
          </p>
        )}
        <p>Agradecemos a sua colaboração.</p>
        <p className="fp-carta-assinatura">Departamento Pessoal<br />Pateo da Luz</p>
      </div>

      {admissao && (
        <section className="fp-carta-bloco" aria-labelledby="fp-carta-docs">
          <h2 id="fp-carta-docs"><FileCheck2 size={18} aria-hidden="true" /> Tenha em mãos</h2>
          <ul className="fp-carta-lista">
            {DOCUMENTOS_ADMISSAO.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </section>
      )}

      <ul className="fp-carta-fatos" aria-label="Informações sobre o preenchimento">
        <li><Clock3 size={18} aria-hidden="true" /><span><strong>{admissao ? "Cerca de 10 minutos" : "Poucos minutos"}</strong>Os dados são salvos a cada etapa — dá para continuar depois pelo mesmo link.</span></li>
        {expiraEm && (
          <li><CalendarClock size={18} aria-hidden="true" /><span><strong>Prazo: até {dataLonga(expiraEm)}</strong>Depois dessa data o link deixa de funcionar.</span></li>
        )}
        <li><ShieldCheck size={18} aria-hidden="true" /><span><strong>Sigilo dos seus dados</strong>Usados exclusivamente pelo Pateo da Luz e pela contabilidade para o registro e as obrigações trabalhistas, conforme a Lei nº 13.709/2018 (LGPD).</span></li>
      </ul>

      <button type="button" className="fp-botao fp-botao--principal fp-carta-botao" onClick={onIniciar}>
        {jaComecou ? "Continuar o preenchimento" : "Iniciar o preenchimento"} <ArrowRight size={18} aria-hidden="true" />
      </button>
      <p className="fp-carta-rodape">Em caso de dúvida, procure o Departamento Pessoal do Pateo da Luz.</p>
    </article>
  );
}
