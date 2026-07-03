import type { FormEvent, ReactNode } from "react";
import "./LoginShell.css";

export type LoginShellProps = {
  /** Se fornecido, o card usa <form onSubmit={onSubmit}> ao inves de <div>. */
  onSubmit?: (event: FormEvent) => void;
  /** Brand block (logo + h1 + subtitulo). Se omitido, brandTitle vira o h1. */
  brand?: ReactNode;
  brandTitle?: ReactNode;
  brandSubtitle?: ReactNode;
  brandLogoSrc?: string;
  brandLogoAlt?: string;
  /** Ano de fundacao para renderizar chip "Desde XXXX" abaixo do brand. */
  desdeYear?: string;
  /** Conteudo do card (form fields, alerts, botao Entrar). */
  children: ReactNode;
  /** Class extra no card (raro). */
  cardClassName?: string;
};

export function LoginShell({
  onSubmit,
  brand,
  brandTitle,
  brandSubtitle,
  brandLogoSrc = "/logo-pateo-luz.png",
  brandLogoAlt = "Pateo da Luz",
  desdeYear,
  children,
  cardClassName
}: LoginShellProps) {
  const cardClasses = cardClassName ? `ds-login-card ${cardClassName}` : "ds-login-card";
  const cardBody = (
    <>
      {brand ?? (
        <div className="ds-login-brand">
          <img
            src={brandLogoSrc}
            alt={brandLogoAlt}
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
          {brandTitle && <h1>{brandTitle}</h1>}
          {brandSubtitle && <p className="ds-login-brand-subtitle">{brandSubtitle}</p>}
        </div>
      )}
      {desdeYear && <span className="ds-login-desde">Desde {desdeYear}</span>}
      {children}
    </>
  );

  return (
    <main className="ds-login-shell">
      {onSubmit ? (
        <form className={cardClasses} onSubmit={onSubmit} autoComplete="off">
          {cardBody}
        </form>
      ) : (
        <div className={cardClasses}>{cardBody}</div>
      )}
    </main>
  );
}
