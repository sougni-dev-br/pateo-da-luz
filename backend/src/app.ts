import "express-async-errors";
import cors from "cors";
import express from "express";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { importConflictRouter } from "./modules/import-conflicts/import-conflict.routes.js";
import { importRouter } from "./modules/imports/import.routes.js";
import { agileIntegrationRouter } from "./modules/integrations/agile/agile-sync.routes.js";
import { ifoodDeliveryRouter } from "./modules/integrations/delivery/ifood/ifood.routes.js";
import { noventaNoveDeliveryRouter, noventaNovePublicRouter } from "./modules/integrations/delivery/noventa-nove/noventa-nove.routes.js";
import { notificationsAdminRouter, notificationsPublicRouter } from "./modules/notifications/notifications.routes.js";
import { receivableRouter } from "./modules/receivables/receivable.routes.js";
import { ifoodExpenseRouter } from "./modules/ifood-expenses/ifood-expense.routes.js";
import { inventoryRouter } from "./modules/inventory/inventory.routes.js";
import { cmvRealRouter } from "./modules/cmv-real/cmv-real.routes.js";
import { cardsRouter } from "./modules/cards/cards.routes.js";
import { masterDataRouter } from "./modules/master-data/master-data.routes.js";
import { dishesRouter } from "./modules/dishes/dishes.routes.js";
import { dreRouter } from "./modules/dre/dre.routes.js";
import { monthlyRouter } from "./modules/monthly/monthly.routes.js";
import { monthlyClosureRouter } from "./modules/monthly-closure/monthly-closure.routes.js";
import { paymentMethodRouter } from "./modules/payment-methods/payment-method.routes.js";
import { productRouter } from "./modules/products/product.routes.js";
import { purchaseOrderRouter } from "./modules/purchase-orders/purchase-order.routes.js";
import { purchaseRouter } from "./modules/purchases/purchase.routes.js";
import { supplierRouter } from "./modules/suppliers/supplier.routes.js";
import { supplierCyclesRouter } from "./modules/suppliers/supplier-cycles.routes.js";
import { taxPaymentRouter } from "./modules/tax-payments/tax-payment.routes.js";
import { companyRouter } from "./modules/companies/company.routes.js";
import { employeeRouter } from "./modules/payroll/employee.routes.js";
import { scheduleRouter } from "./modules/payroll/schedule.routes.js";
import { payrollRouter } from "./modules/payroll/payroll.routes.js";
import { authRouter, userRouter } from "./modules/security/auth.routes.js";
import { requireMenuAccess } from "./modules/security/menu-permissions.js";
import { jsonSafe } from "./shared/utils/json-safe.js";

export const app = express();

const ALLOWED_ORIGINS = [
  "https://pateo.sougni.com",
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
];
// Em dev (NODE_ENV != production) qualquer origem localhost/127.0.0.1 é aceita
// para acomodar portas dinâmicas do preview MCP e outras ferramentas locais.
// Em produção, apenas o whitelist explícito.
const LOCALHOST_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    if (!IS_PRODUCTION && LOCALHOST_PATTERN.test(origin)) return callback(null, true);
    callback(new Error(`CORS: origin não permitida: ${origin}`));
  },
  credentials: true,
}));
// Limite generoso para acomodar o payload do agente Agile PDV
// (backfill de 6 meses pode ficar em ~10 MB de JSON com vendas + pagamentos + itens).
// verify() salva o rawBody UTF-8 apenas em rotas que precisam validar
// assinatura HMAC contra o corpo original (99 Food webhook). O rawBody
// fica em req.rawBody para os handlers consumirem sem re-serialização.
app.use(express.json({
  limit: "25mb",
  verify: (req, _res, buf) => {
    const url = req.url ?? "";
    if (url.includes("/public/delivery/noventa-nove/webhook")) {
      (req as express.Request & { rawBody?: string }).rawBody = buf.toString("utf8");
    }
  }
}));
app.use((_request, response, next) => {
  const originalJson = response.json.bind(response);
  response.json = ((body: unknown) => originalJson(jsonSafe(body))) as typeof response.json;
  next();
});

// Carimbo de identidade da instância. Permite confirmar de fora qual commit
// está no ar e desde quando, sem precisar de sessão — antes disso o /health
// devolvia um literal estático e respondia igual na versão velha e na nova,
// então não havia como verificar um deploy sem testar o comportamento na mão.
// RENDER_GIT_COMMIT é injetado pelo Render; em dev fica null.
const BUILD_COMMIT = process.env.RENDER_GIT_COMMIT ?? null;
const BOOTED_AT = new Date().toISOString();

app.get("/health", (_request, response) => {
  response.json({ status: "ok", commit: BUILD_COMMIT, bootedAt: BOOTED_AT });
});

app.use("/auth", authRouter);
// Rotas PÚBLICAS (chamadas por terceiros/webhooks) ficam ANTES do
// requireMenuAccess pra bypassar o middleware de sessão.
app.use("/public/delivery/noventa-nove", noventaNovePublicRouter);
// Notifications público (trigger via cron): autenticado por token próprio
// (X-Daily-Summary-Token). Precisa ficar ANTES do requireMenuAccess.
app.use("/notifications", notificationsPublicRouter);
app.use(requireMenuAccess);
// Notifications admin (CRUD destinatários, status/QR/restart): autenticado
// por sessão via menu id "notifications" — configurado abaixo.
app.use("/notifications", notificationsAdminRouter);
app.use("/suppliers", supplierRouter);
app.use("/supplier-cycles", supplierCyclesRouter);
app.use("/companies", companyRouter);
app.use("/employees", employeeRouter);
app.use("/schedule", scheduleRouter);
app.use("/payroll", payrollRouter);
app.use("/users", userRouter);
app.use("/products", productRouter);
app.use("/payment-methods", paymentMethodRouter);
app.use("/purchase-orders", purchaseOrderRouter);
app.use("/purchases", purchaseRouter);
app.use("/cards", cardsRouter);
app.use("/imports", importRouter);
app.use("/import-conflicts", importConflictRouter);
app.use("/inventory", inventoryRouter);
app.use("/monthly/cmv-real", cmvRealRouter);
app.use("/monthly-closure", monthlyClosureRouter);
app.use("/monthly", monthlyRouter);
app.use("/audit", auditRouter);
app.use("/dashboard", dashboardRouter);
app.use("/master-data", masterDataRouter);
app.use("/dishes", dishesRouter);
app.use("/dre", dreRouter);
app.use("/tax-payments", taxPaymentRouter);
app.use("/integrations/agile", agileIntegrationRouter);
app.use("/integrations/delivery/ifood", ifoodDeliveryRouter);
app.use("/integrations/delivery/noventa-nove", noventaNoveDeliveryRouter);
app.use("/receivables", receivableRouter);
app.use("/ifood-expenses", ifoodExpenseRouter);

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled API error", error);
  if (response.headersSent) return;
  const message = error instanceof Error ? error.message : "Erro interno do servidor.";
  response.status(500).json({ message });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception", error);
});
