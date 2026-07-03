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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
