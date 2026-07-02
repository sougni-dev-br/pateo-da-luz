import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { Alert } from "../components/Alert";
import { EmptyState } from "../components/EmptyState";

type Props = {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackDescription?: string;
};

type State = { error: Error | null };

/**
 * ErrorBoundary para o content area do shell. Se uma pagina falhar em render,
 * mantem o shell (sidebar/topbar) visivel e mostra um EmptyState no lugar da
 * pagina. Sem essa boundary, o AppShell tambem desmonta e o usuario fica com
 * tela branca.
 */
export class ContentErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error("[ContentErrorBoundary] Página falhou em render:", error, info);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div style={{ display: "grid", gap: 16 }}>
          <Alert tone="error">
            {this.props.fallbackTitle ?? "Esta página não pôde ser renderizada."}
          </Alert>
          <EmptyState
            title={this.props.fallbackTitle ?? "Página indisponível"}
            description={
              this.props.fallbackDescription ??
              `Detalhe: ${this.state.error.message}. Tente recarregar a página ou navegue para outra seção pela sidebar.`
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}
