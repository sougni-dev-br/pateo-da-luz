import cors from "cors";
import express from "express";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { importConflictRouter } from "./modules/import-conflicts/import-conflict.routes.js";
import { importRouter } from "./modules/imports/import.routes.js";
import { inventoryRouter } from "./modules/inventory/inventory.routes.js";
import { cmvRealRouter } from "./modules/cmv-real/cmv-real.routes.js";
import { cardsRouter } from "./modules/cards/cards.routes.js";
import { masterDataRouter } from "./modules/master-data/master-data.routes.js";
import { dishesRouter } from "./modules/dishes/dishes.routes.js";
import { dreRouter } from "./modules/dre/dre.routes.js";
import { monthlyRouter } from "./modules/monthly/monthly.routes.js";
import { paymentMethodRouter } from "./modules/payment-methods/payment-method.routes.js";
import { productRouter } from "./modules/products/product.routes.js";
import { purchaseOrderRouter } from "./modules/purchase-orders/purchase-order.routes.js";
import { purchaseRouter } from "./modules/purchases/purchase.routes.js";
import { supplierRouter } from "./modules/suppliers/supplier.routes.js";
import { authRouter, userRouter } from "./modules/security/auth.routes.js";
import { requireMenuAccess } from "./modules/security/menu-permissions.js";
import { jsonSafe } from "./shared/utils/json-safe.js";

export const app = express();

const ALLOWED_ORIGINS = [
  "https://pateo.sougni.com",
  "http://localhost:5173",
  "http://localhost:5174",
];
app.use(cors({
  origin: (origin, callback) => {
    // permitir chamadas sem origin (ex: Render health checks, curl)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin não permitida: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use((_request, response, next) => {
  const originalJson = response.json.bind(response);
  response.json = ((body: unknown) => originalJson(jsonSafe(body))) as typeof response.json;
  next();
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use(requireMenuAccess);
app.use("/suppliers", supplierRouter);
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
app.use("/monthly", monthlyRouter);
app.use("/audit", auditRouter);
app.use("/dashboard", dashboardRouter);
app.use("/master-data", masterDataRouter);
app.use("/dishes", dishesRouter);
app.use("/dre", dreRouter);

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
