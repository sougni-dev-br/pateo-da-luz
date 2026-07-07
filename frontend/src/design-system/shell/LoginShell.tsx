import { Check } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import "./LoginShell.css";

export type LoginShellProps = {
  /** Se fornecido, o card usa <form onSubmit={onSubmit}> ao inves de <div>. */
  onSubmit?: (event: FormEvent) => void;
  /** Nome da marca exibido no aside desktop e no header mobile. */
  brandName?: ReactNode;
  /** Legenda curta (ex.: "Desde 2003") mostrada abaixo do nome. */
  brandTagline?: ReactNode;
  brandLogoSrc?: string;
  brandLogoAlt?: string;
  /** Eyebrow (uppercase, tracked) acima do headline do aside. */
  showcaseEyebrow?: ReactNode;
  /** Headline principal do aside (h2). Aceita JSX para destacar palavras. */
  showcaseHeadline?: ReactNode;
  /** Paragrafo de apoio abaixo do headline. */
  showcaseDescription?: ReactNode;
  /** Lista de features com check verde. */
  showcaseFeatures?: string[];
  /** Rodape do aside (ex.: "Sistema online"). */
  showcaseStatus?: ReactNode;
  /** Chips compactos exibidos no header mobile. */
  mobileFeatures?: string[];
  /** Titulo (h1) acima do formulario. */
  formTitle?: ReactNode;
  /** Subtitulo abaixo do titulo do formulario. */
  formSubtitle?: ReactNode;
  /** Rodape legal do card. */
  legal?: ReactNode;
  /** Conteudo do card (form fields, alerts, botao Entrar). */
  children: ReactNode;
  /** Class extra no card. */
  cardClassName?: string;
};

const DEFAULT_FEATURES = [
  "Financeiro em tempo real",
  "Compras & estoque integrados",
  "DRE gerencial automático"
];

const DEFAULT_MOBILE_FEATURES = ["Financeiro", "Compras", "Estoque"];

export function LoginShell({
  onSubmit,
  brandName = "Pateo da Luz",
  brandTagline = "Desde 2003",
  brandLogoSrc = "/logo-pateo-luz.png",
  brandLogoAlt = "Pateo da Luz",
  showcaseEyebrow = "Gestão do restaurante",
  showcaseHeadline,
  showcaseDescription = "Financeiro, compras e estoque em um único painel — do lançamento da nota ao resultado do mês.",
  showcaseFeatures = DEFAULT_FEATURES,
  showcaseStatus,
  mobileFeatures = DEFAULT_MOBILE_FEATURES,
  formTitle = "Bem-vindo de volta",
  formSubtitle = "Entre com suas credenciais para acessar o painel.",
  legal = "Acesso restrito · Pateo da Luz © 2026",
  children,
  cardClassName
}: LoginShellProps) {
  const cardClasses = cardClassName ? `ds-login-card ${cardClassName}` : "ds-login-card";

  const brandBlock = (
    <>
      <span className="ds-login-logo">
        <img
          src={brandLogoSrc}
          alt={brandLogoAlt}
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </span>
      <div className="ds-login-brand-text">
        <strong>{brandName}</strong>
        {brandTagline && <small>{brandTagline}</small>}
      </div>
    </>
  );

  const headline = showcaseHeadline ?? (
    <>
      Toda a operação
      <br />
      sob <em>uma só luz</em>.
    </>
  );

  const cardBody = (
    <>
      <div className="ds-login-head">
        {formTitle && <h1>{formTitle}</h1>}
        {formSubtitle && <p>{formSubtitle}</p>}
      </div>
      {children}
      {legal && <p className="ds-login-legal">{legal}</p>}
    </>
  );

  return (
    <div className="ds-login-shell">
      <aside className="ds-login-aside" aria-hidden="true">
        <div className="ds-login-aside-top">{brandBlock}</div>
        <div className="ds-login-aside-body">
          {showcaseEyebrow && <span className="ds-login-eyebrow">{showcaseEyebrow}</span>}
          <h2>{headline}</h2>
          {showcaseDescription && <p>{showcaseDescription}</p>}
          {showcaseFeatures.length > 0 && (
            <ul className="ds-login-feats">
              {showcaseFeatures.map((feat) => (
                <li key={feat}>
                  <Check size={15} />
                  {feat}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="ds-login-aside-foot">
          <span className="ds-login-dot" />
          {showcaseStatus ?? "Sistema online · sincronizado agora há pouco"}
        </div>
      </aside>

      <main className="ds-login-main">
        <div className="ds-login-mobile-brand">
          {brandBlock}
          {mobileFeatures.length > 0 && (
            <div className="ds-login-mfeats">
              {mobileFeatures.map((feat) => (
                <span key={feat}>
                  <Check size={13} />
                  {feat}
                </span>
              ))}
            </div>
          )}
        </div>
        {onSubmit ? (
          <form className={cardClasses} onSubmit={onSubmit} autoComplete="off">
            {cardBody}
          </form>
        ) : (
          <div className={cardClasses}>{cardBody}</div>
        )}
      </main>
    </div>
  );
}
