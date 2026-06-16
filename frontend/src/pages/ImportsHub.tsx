import { ArrowRight, Database, FileSpreadsheet, Layers3, WalletCards } from "lucide-react";
import { CatalogImports } from "./CatalogImports";
import { ImportExcel } from "./ImportExcel";
import { MonthlyInventoryImportPanel } from "../components/MonthlyInventoryImportPanel";
import { ImportHistoryPanel } from "../components/ImportHistoryPanel";
import { RevenueImportPanel } from "../components/RevenueImportPanel";

export type ImportTab = "purchases" | "catalog-imports" | "monthly-closing" | "revenue" | "history";

type ImportsHubProps = {
  activeTab: ImportTab;
  onTabChange: (tab: ImportTab) => void;
  onNavigate: (section: "purchases" | "catalog-imports" | "monthly-closing" | "revenue") => void;
};

const tabs: Array<{ id: ImportTab; label: string; description: string; icon: typeof FileSpreadsheet }> = [
  {
    id: "purchases",
    label: "Compras",
    description: "Planilhas de compras, fornecedores, produtos, vencimentos e pequenos gastos.",
    icon: FileSpreadsheet
  },
  {
    id: "catalog-imports",
    label: "Cadastros",
    description: "Fornecedores, produtos, formas de pagamento e tipos de pequeno gasto.",
    icon: Database
  },
  {
    id: "monthly-closing",
    label: "Inventario mensal",
    description: "Importacao de inventarios e snapshots usados no fechamento e CMV.",
    icon: Layers3
  },
  {
    id: "revenue",
    label: "Faturamento",
    description: "Planilhas mensais de faturamento diario por canal.",
    icon: WalletCards
  },
  {
    id: "history",
    label: "Histórico",
    description: "Lotes importados, usuário, data, total de linhas, importadas e desfazer quando permitido.",
    icon: ArrowRight
  }
];

export function ImportsHub({ activeTab, onTabChange, onNavigate }: ImportsHubProps) {
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const Icon = active.icon;

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <p>Central operacional</p>
            <h2>Importacoes</h2>
          </div>
          <Icon size={22} />
        </div>

        <div className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              type="button"
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <p className="muted-inline">{active.description}</p>

        <div className="actions-cell wrap" style={{ marginTop: 16 }}>
          <button className="secondary-button" type="button" onClick={() => onNavigate("purchases")}>
            <FileSpreadsheet size={16} /> Abrir compras
          </button>
          <button className="secondary-button" type="button" onClick={() => onNavigate("revenue")}>
            <WalletCards size={16} /> Abrir faturamento
          </button>
          <button className="secondary-button" type="button" onClick={() => onNavigate("monthly-closing")}>
            <Layers3 size={16} /> Abrir fechamento mensal
          </button>
          <button className="secondary-button" type="button" onClick={() => onNavigate("catalog-imports")}>
            <Database size={16} /> Abrir cadastros
          </button>
        </div>
      </section>

      {activeTab === "purchases" && <ImportExcel />}
      {activeTab === "catalog-imports" && <CatalogImports />}
      {activeTab === "monthly-closing" && <MonthlyInventoryImportPanel />}
      {activeTab === "revenue" && <RevenueImportPanel onOpenRevenue={() => onNavigate("revenue")} />}
      {activeTab === "history" && <ImportHistoryPanel />}
    </div>
  );
}
