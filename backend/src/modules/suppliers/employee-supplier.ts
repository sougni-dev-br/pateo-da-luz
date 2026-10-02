// Reembolso a funcionário é lançado como compra/despesa de um fornecedor. Em vez de
// redigitar nome, CPF e PIX, o cadastro do fornecedor é preenchido a partir do funcionário.

export type EmployeeForSupplier = {
  id: string;
  firstName: string;
  lastName: string;
  cpf: string;
  phone: string | null;
  email: string | null;
  position: string | null;
  isActive: boolean;
  bankName: string | null;
  bankAgency: string | null;
  bankAccount: string | null;
  bankAccountDigit: string | null;
  bankAccountType: string;
  pixKeyType: string | null;
  pixKey: string | null;
};

export type SupplierDraft = {
  name: string;
  document: string;
  phone: string;
  email: string;
  mainCategory: string;
  defaultFinancialNotes: string;
  notes: string;
};

export const EMPLOYEE_SUPPLIER_CATEGORY = "Funcionário";

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  CONTA_CORRENTE: "Conta corrente",
  POUPANCA: "Poupança"
};

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export function formatCpf(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length !== 11) return value.trim();
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function employeeFullName(employee: Pick<EmployeeForSupplier, "firstName" | "lastName">): string {
  return `${employee.firstName} ${employee.lastName}`.replace(/\s+/g, " ").trim();
}

export function employeePaymentDetails(employee: EmployeeForSupplier): string {
  const parts: string[] = [];
  const pixKey = employee.pixKey?.trim();
  if (pixKey) {
    const pixType = employee.pixKeyType?.trim();
    parts.push(pixType ? `PIX (${pixType}): ${pixKey}` : `PIX: ${pixKey}`);
  }
  const account = employee.bankAccount?.trim();
  if (account) {
    const digit = employee.bankAccountDigit?.trim();
    const bank = [
      employee.bankName?.trim() ? `Banco ${employee.bankName.trim()}` : null,
      employee.bankAgency?.trim() ? `Ag. ${employee.bankAgency.trim()}` : null,
      `${ACCOUNT_TYPE_LABEL[employee.bankAccountType] ?? "Conta"} ${digit ? `${account}-${digit}` : account}`
    ].filter(Boolean);
    parts.push(bank.join(" · "));
  }
  return parts.join(" | ");
}

export function employeeToSupplierDraft(employee: EmployeeForSupplier): SupplierDraft {
  return {
    name: employeeFullName(employee),
    document: formatCpf(employee.cpf),
    phone: employee.phone?.trim() ?? "",
    email: employee.email?.trim() ?? "",
    mainCategory: EMPLOYEE_SUPPLIER_CATEGORY,
    defaultFinancialNotes: employeePaymentDetails(employee),
    notes: "Cadastro reaproveitado do funcionário (reembolsos)."
  };
}
