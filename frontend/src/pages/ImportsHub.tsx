import { ArrowRight, Database, FileSpreadsheet, Layers3, WalletCards } from "lucide-react";
import { CatalogImports } from "./CatalogImports";
import { ImportExcel } from "./ImportExcel";
import { MonthlyInventoryImportPanel } from "../components/MonthlyInventoryImportPanel";
import { ImportHistoryPanel } from "../components/ImportHistoryPanel";
import { RevenueImportPanel } from "../components/RevenueImportPanel";
import { Button, PanelEyebrow, Tabs } from "../design-system";

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
    label: "Inventário mensal",
    description: "Importação de inventários e snapshots usados no fechamento e CMV.",
    icon: Layers3
  },
  {
    id: "revenue",
    label: "Faturamento",
    description: "Planilhas mensais de faturamento diário por canal.",
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
          <PanelEyebrow>Central de importações</PanelEyebrow>
          <Icon size={22} />
        </div>

        <Tabs
          value={activeTab}
          onChange={(v) => onTabChange(v as ImportTab)}
          tabs={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
        />

        <p className="muted-inline">{active.description}</p>

        <div className="actions-cell wrap" style={{ marginTop: 16 }}>
          <Button variant="secondary" leadingIcon={<FileSpreadsheet size={16} />} onClick={() => onNavigate("purchases")}>Abrir compras</Button>
          <Button variant="secondary" leadingIcon={<WalletCards size={16} />} onClick={() => onNavigate("revenue")}>Abrir faturamento</Button>
          <Button variant="secondary" leadingIcon={<Layers3 size={16} />} onClick={() => onNavigate("monthly-closing")}>Abrir fechamento mensal</Button>
          <Button variant="secondary" leadingIcon={<Database size={16} />} onClick={() => onNavigate("catalog-imports")}>Abrir cadastros</Button>
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
