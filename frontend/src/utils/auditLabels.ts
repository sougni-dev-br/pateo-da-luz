// Traduções amigáveis das ações de auditoria (SNAKE_CASE do backend → português).
// Ações não mapeadas caem no humanizador (labelAction) em vez de aparecer cru.
const ACTION_LABELS: Record<string, string> = {
  // Genéricas (dishes, dre, master-data, inventory)
  CREATE: "Criação",
  CREATED: "Criado",
  UPDATE: "Atualização",
  DELETE: "Exclusão",
  BULK_UPDATE: "Atualização em massa",

  // Autenticação e segurança
  LOGIN: "Login",
  LOGOUT: "Logout",
  LOGIN_BLOCKED: "Login bloqueado",
  LOGIN_INVALID: "Login inválido",
  LOGIN_AFTER_INACTIVITY_EXPIRY: "Login após expiração por inatividade",
  LOGIN_BLOCKED_SESSION_CONFLICT: "Login bloqueado (conflito de sessão)",
  SESSION_FORCE_REPLACED: "Sessão substituída à força",
  LOGIN_SESSION_CONFIGURATION_ERROR: "Erro de configuração de sessão no login",
  SESSION_EXPIRED_BY_INACTIVITY: "Sessão expirada por inatividade",
  KILL_USER_SESSIONS: "Encerramento de sessões do usuário",
  CREATE_USER: "Criação de usuário",
  CREATE_USER_FAILED: "Falha ao criar usuário",
  UPDATE_USER: "Atualização de usuário",
  UPDATE_USER_MENU_PERMISSIONS: "Permissões de menu do usuário atualizadas",
  UPDATE_ROLE_MENU_PERMISSIONS: "Permissões de menu do perfil atualizadas",
  CHANGE_PASSWORD: "Alteração de senha",

  // Folha de pagamento e funcionários
  SAVE_SCHEDULE: "Escala salva",
  UPDATE_PAYROLL_SETTINGS: "Configurações da folha atualizadas",
  GENERATE_PAYROLL: "Folha gerada",
  RELEASE_TERMINATION: "Rescisão liberada",
  RELEASE_VACATION: "Férias lançadas",
  PAY_PAYROLL_ITEM: "Pagamento de lançamento da folha",
  REVERSE_PAYROLL_ITEM: "Estorno de lançamento da folha",
  RESTORE_PAYROLL_ITEM: "Restauração de lançamento da folha",
  EDIT_PAYROLL_ITEM: "Edição de lançamento da folha",
  DELETE_PAYROLL_ITEM: "Exclusão de lançamento da folha",
  CREATE_EMPLOYEE: "Cadastro de funcionário",
  UPDATE_EMPLOYEE: "Atualização de funcionário",
  TERMINATE_EMPLOYEE: "Desligamento de funcionário",
  ADJUST_HOLIDAY_COMP: "Ajuste de compensação de feriado",
  RESTORE_EMPLOYEE: "Restauração de funcionário",
  DELETE_EMPLOYEE: "Exclusão de funcionário",

  // Empresas e contas bancárias
  CREATE_COMPANY: "Criação de empresa",
  UPDATE_COMPANY: "Atualização de empresa",
  CREATE_BANK_ACCOUNT: "Criação de conta bancária",
  UPDATE_BANK_ACCOUNT: "Atualização de conta bancária",

  // Cartões de crédito
  UPDATE_CREDIT_CARD_STATEMENT_STATUS: "Status da fatura do cartão atualizado",
  ADD_CREDIT_CARD_STATEMENT_ITEM: "Item adicionado à fatura do cartão",
  UPDATE_CREDIT_CARD_STATEMENT_ITEM: "Item da fatura do cartão atualizado",
  REALLOCATE_CREDIT_CARD_STATEMENT_ITEM: "Item da fatura remanejado",
  CLOSE_CREDIT_CARD_STATEMENT: "Fatura do cartão fechada",
  REOPEN_CREDIT_CARD_STATEMENT: "Fatura do cartão reaberta",
  PAY_CREDIT_CARD_STATEMENT: "Fatura do cartão paga",
  GENERATE_CREDIT_CARD_STATEMENT_PDF: "PDF da fatura do cartão gerado",
  GENERATE_SMALL_EXPENSES_PDF: "PDF de pequenas despesas gerado",
  LINK_PURCHASE_TO_CREDIT_CARD: "Compra vinculada ao cartão",

  // Impostos / guias
  CREATE_TAX_PAYMENT: "Criação de imposto/guia",
  UPDATE_TAX_PAYMENT: "Atualização de imposto/guia",
  DELETE_TAX_PAYMENT: "Exclusão de imposto/guia",
  PAY_TAX_PAYMENT: "Pagamento de imposto/guia",
  REVERSE_TAX_PAYMENT: "Estorno de imposto/guia",
  IMPORT_TAX_PAYMENTS: "Importação de impostos/guias",

  // CMV
  CALCULATE_CMV_PERIOD: "Cálculo de CMV do período",
  CLOSE_CMV_PERIOD: "Fechamento de CMV do período",
  REOPEN_CMV_PERIOD: "Reabertura de CMV do período",
  DELETE_CMV_PERIOD: "Exclusão de CMV do período",
  GENERATE_CMV_REAL_PDF: "PDF do CMV real gerado",

  // Fechamento mensal
  JUSTIFY_MONTHLY_CLOSURE_BLOCK: "Justificativa de bloqueio do fechamento mensal",
  REMOVE_MONTHLY_CLOSURE_JUSTIFICATION: "Remoção da justificativa do fechamento mensal",
  LOCK_MONTHLY_CLOSURE: "Fechamento mensal travado",
  UNLOCK_MONTHLY_CLOSURE: "Fechamento mensal destravado",

  // Faturamento
  CREATE_REVENUE_ENTRY: "Lançamento de faturamento",
  BLOCK_DAILY_REVENUE_CLOSE: "Bloqueio de fechamento diário de faturamento",
  CLOSE_DAILY_REVENUE: "Fechamento diário de faturamento",
  UPDATE_REVENUE_ENTRY: "Atualização de faturamento",
  CANCEL_REVENUE_ENTRY: "Cancelamento de faturamento",
  IMPORT_REVENUE_EXCEL: "Faturamento importado (Excel)",
  UNDO_REVENUE_IMPORT_BATCH: "Importação de faturamento desfeita",

  // Setores de inventário / dados mestres
  CREATE_INVENTORY_SECTOR: "Criação de setor de inventário",
  UPDATE_INVENTORY_SECTOR: "Atualização de setor de inventário",

  // Produtos
  APPLY_PRODUCT_INVENTORY_INTEGRITY_SUGGESTIONS: "Sugestões de integridade de estoque aplicadas",
  BULK_SET_DRE_CATEGORY: "Categoria DRE definida em massa",
  CREATE_PRODUCT: "Criação de produto",
  BLOCK_PRODUCT_CODE_CHANGE: "Alteração de código de produto bloqueada",
  UPDATE_PRODUCT_PURCHASE_PARAMETERS: "Parâmetros de compra do produto atualizados",
  UPDATE_PRODUCT: "Atualização de produto",

  // Fornecedores e ciclos
  CREATE_SUPPLIER: "Criação de fornecedor",
  BLOCK_SUPPLIER_CODE_CHANGE: "Alteração de código de fornecedor bloqueada",
  UPDATE_SUPPLIER: "Atualização de fornecedor",
  CREATE_SUPPLIER_CYCLE: "Criação de ciclo de fornecedor",
  CLOSE_SUPPLIER_CYCLE: "Fechamento de ciclo de fornecedor",
  EDIT_SUPPLIER_CYCLE: "Edição de ciclo de fornecedor",
  ADD_PURCHASE_TO_CYCLE: "Compra adicionada ao ciclo",
  REMOVE_PURCHASE_FROM_CYCLE: "Compra removida do ciclo",
  MOVE_PURCHASE_BETWEEN_CYCLES: "Compra movida entre ciclos",

  // Inventário / contagens de estoque
  MARK_STOCK_COUNT_LATE: "Contagem marcada como atrasada",
  BLOCK_STOCK_COUNT_SESSION_EDIT: "Edição de sessão de contagem bloqueada",
  BLOCK_OPERATIONAL_INVENTORY_EDIT: "Edição de inventário operacional bloqueada",
  CREATE_INVENTORY_SNAPSHOT_FROM_OPERATIONAL: "Snapshot de inventário criado a partir do operacional",
  CREATE_STOCK_COUNT_SESSION: "Criação de sessão de contagem",
  CONSOLIDATE_MONTH_END_SESSIONS: "Consolidação de sessões de fim de mês",
  CREATE_COMPLEMENTARY_COUNT: "Criação de contagem complementar",
  APPEND_COMPLEMENTARY_COUNT: "Contagem complementar anexada",
  SAVE_STOCK_COUNT_SESSION_DRAFT: "Rascunho de contagem salvo",
  BLOCK_CONCLUDE_STOCK_COUNT_SESSION_PENDING_ITEMS: "Conclusão de contagem bloqueada (itens pendentes)",
  BLOCK_CONCLUDE_STOCK_COUNT_SESSION_MISSING_PRODUCTS: "Conclusão de contagem bloqueada (produtos faltando)",
  CONCLUDE_STOCK_COUNT_SESSION: "Conclusão de sessão de contagem",
  RESHAPE_STOCK_COUNT_SESSION_SCOPE: "Escopo da sessão de contagem alterado",
  REOPEN_STOCK_COUNT_SESSION: "Reabertura de sessão de contagem",
  BLOCK_CANCEL_STOCK_COUNT_SESSION: "Cancelamento de contagem bloqueado",
  CANCEL_STOCK_COUNT_SESSION: "Cancelamento de sessão de contagem",
  GENERATE_OPERATIONAL_INVENTORY_FROM_COUNT: "Inventário operacional gerado a partir da contagem",
  CREATE_OPERATIONAL_INVENTORY: "Criação de inventário operacional",
  GENERATE_OPERATIONAL_INVENTORY_ITEMS: "Itens do inventário operacional gerados",
  VIEW_BUYER_SUPPORT_REPORT: "Relatório de apoio ao comprador visualizado",
  EXPORT_BUYER_PRELIST_CSV: "Pré-lista do comprador exportada (CSV)",
  GENERATE_OPERATIONAL_INVENTORY_PDF: "PDF do inventário operacional gerado",
  SAVE_OPERATIONAL_INVENTORY_DRAFT: "Rascunho do inventário operacional salvo",
  MARK_OPERATIONAL_INVENTORY_ZERO: "Inventário operacional marcado como zero",
  SUBMIT_OPERATIONAL_INVENTORY: "Inventário operacional enviado",
  APPROVE_OPERATIONAL_INVENTORY: "Inventário operacional aprovado",
  REJECT_OPERATIONAL_INVENTORY: "Inventário operacional rejeitado",
  CLOSE_OPERATIONAL_INVENTORY: "Inventário operacional fechado",
  CANCEL_OPERATIONAL_INVENTORY: "Inventário operacional cancelado",
  REOPEN_OPERATIONAL_INVENTORY: "Inventário operacional reaberto",
  UPDATE_STOCK_MIN_QUANTITY: "Estoque mínimo atualizado",
  CREATE_INVENTORY_AGENDA: "Criação de agenda de inventário",
  UPDATE_INVENTORY_AGENDA: "Atualização de agenda de inventário",
  DELETE_INVENTORY_AGENDA: "Exclusão de agenda de inventário",
  START_STOCK_COUNT: "Início de contagem de estoque",
  SUBMIT_STOCK_COUNT: "Envio de contagem de estoque",
  CREATE_INVENTORY_REQUISITION: "Criação de requisição de inventário",
  CONFIRM_STOCK_COUNT: "Confirmação de contagem de estoque",

  // Compras e contas a pagar
  GENERATE_SUPPLIER_POSITION_PDF: "PDF de posição do fornecedor gerado",
  GENERATE_PAYABLES_FINANCIAL_PDF: "PDF financeiro de contas a pagar gerado",
  PAY_INSTALLMENT: "Pagamento de parcela",
  REVERSE_INSTALLMENT_PAYMENT: "Estorno de pagamento de parcela",
  BLOCK_PURCHASE_TOTAL_DIVERGENCE: "Compra bloqueada (divergência de total)",
  BLOCK_PURCHASE_INSTALLMENT_DIVERGENCE: "Compra bloqueada (divergência de parcelas)",
  BLOCK_DUPLICATE_PURCHASE: "Compra duplicada bloqueada",
  ADD_PURCHASE_ITEM: "Item de compra adicionado",
  CREATE_PAYABLE_TITLES: "Títulos a pagar criados",
  ADD_TO_SUPPLIER_CYCLE: "Adicionado ao ciclo do fornecedor",
  AUTHORIZE_PURCHASE_INSTALLMENT_DIVERGENCE: "Divergência de parcelas autorizada",
  MANUAL_PURCHASE_NOT_SAVED: "Compra manual não salva",
  UPDATE_PURCHASE_ITEM: "Item de compra atualizado",
  UPDATE_PAYABLE_TITLES: "Títulos a pagar atualizados",
  RESTORE_PURCHASE: "Restauração de compra",
  IMPORT_PURCHASE: "Compra importada",
  IMPORT_ADD_TO_SUPPLIER_CYCLE: "Compra importada adicionada ao ciclo do fornecedor",

  // Pedidos de compra
  DOWNLOAD_PURCHASE_ORDER_PDF: "PDF do pedido de compra baixado",
  CREATE_PURCHASE_ORDER_FROM_PRELIST: "Pedido de compra criado a partir da pré-lista",
  CREATE_PURCHASE_ORDER_FROM_PLANNING: "Pedido de compra criado a partir do planejamento",
  UPDATE_PURCHASE_ORDER: "Atualização de pedido de compra",
  RECEIVE_PURCHASE_ORDER: "Recebimento de pedido de compra",
  CANCEL_PURCHASE_ORDER: "Cancelamento de pedido de compra",
  EXPORT_PURCHASE_ORDER_CSV: "Pedido de compra exportado (CSV)",
};

// Fallback para ações não mapeadas: "SAVE_PURCHASE" → "Save purchase" (legível, não cru).
function humanize(action: string): string {
  const spaced = action.replace(/_/g, " ").toLowerCase().trim();
  if (!spaced) return action;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function labelAction(action: string): string {
  return ACTION_LABELS[action] ?? humanize(action);
}

// Chaves que costumam guardar a justificativa/motivo de uma ação (ex.: exclusões).
const REASON_KEYS = ["reason", "justificativa", "justification", "motivo", "note", "notes"] as const;

// Extrai o motivo de um registro de auditoria (procura em newValue e previousValue).
export function extractReason(value: unknown): string {
  const sources: unknown[] = Array.isArray(value) ? value : [value];
  for (const src of sources) {
    if (src && typeof src === "object") {
      const obj = src as Record<string, unknown>;
      for (const key of REASON_KEYS) {
        const v = obj[key];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }
  return "";
}
