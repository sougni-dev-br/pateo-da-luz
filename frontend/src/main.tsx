import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ToastProvider } from "./components/ui";
import { installMockFetch } from "./lib/mockUser";
import "./styles/tokens/index.css";
import "./styles/global.css";
import "./styles/kit.css";

// Dev-only: intercepta fetch da API quando ?mock-user=1 esta na URL.
// No-op em producao (isLocal=false). Deve rodar ANTES do createRoot para
// pegar as chamadas do primeiro useEffect (getMe, getMenuFavorites, ...).
installMockFetch();

// Link da ficha cadastral (/ficha/<código>): página pública, fora do login e do menu do
// sistema. Carregada à parte para quem abre pelo celular não baixar o ERP inteiro.
const FichaPublica = React.lazy(() => import("./pages/fichaPublica/FichaPublica"));
const ehFichaPublica = /^\/ficha\/[^/]+\/?$/.test(window.location.pathname);
if (ehFichaPublica) {
  // O código do link está no endereço: não vai como referência para nenhum outro site.
  const semReferencia = document.createElement("meta");
  semReferencia.name = "referrer";
  semReferencia.content = "no-referrer";
  document.head.appendChild(semReferencia);
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {ehFichaPublica ? (
      <React.Suspense fallback={null}>
        <FichaPublica />
      </React.Suspense>
    ) : (
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>
);
