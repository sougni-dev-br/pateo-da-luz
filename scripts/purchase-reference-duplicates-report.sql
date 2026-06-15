WITH normalized AS (
  SELECT
    p."id",
    p."supplierId",
    s."name" AS "supplierName",
    p."status",
    p."purchaseNumber",
    p."purchaseOrderNumber",
    p."invoiceNumber",
    p."purchaseDate",
    p."totalAmount",
    p."normalizedInvoiceNumber",
    p."normalizedPurchaseOrderNumber"
  FROM "Purchase" p
  JOIN "Supplier" s ON s."id" = p."supplierId"
),
invoice_duplicates AS (
  SELECT
    'INVOICE' AS "referenceType",
    "supplierId",
    "supplierName",
    "normalizedInvoiceNumber" AS "normalizedReference",
    COUNT(*) AS "matches",
    COUNT(*) FILTER (WHERE COALESCE("status", 'ACTIVE') <> 'CANCELLED') AS "activeEntries",
    ARRAY_AGG("id" ORDER BY "purchaseDate" DESC) AS "purchaseIds"
  FROM normalized
  WHERE COALESCE("normalizedInvoiceNumber", '') <> ''
  GROUP BY "supplierId", "supplierName", "normalizedInvoiceNumber"
  HAVING COUNT(*) > 1
),
order_duplicates AS (
  SELECT
    'ORDER' AS "referenceType",
    "supplierId",
    "supplierName",
    "normalizedPurchaseOrderNumber" AS "normalizedReference",
    COUNT(*) AS "matches",
    COUNT(*) FILTER (WHERE COALESCE("status", 'ACTIVE') <> 'CANCELLED') AS "activeEntries",
    ARRAY_AGG("id" ORDER BY "purchaseDate" DESC) AS "purchaseIds"
  FROM normalized
  WHERE COALESCE("normalizedPurchaseOrderNumber", '') <> ''
  GROUP BY "supplierId", "supplierName", "normalizedPurchaseOrderNumber"
  HAVING COUNT(*) > 1
)
SELECT * FROM invoice_duplicates
UNION ALL
SELECT * FROM order_duplicates
ORDER BY "activeEntries" DESC, "matches" DESC, "supplierName", "referenceType", "normalizedReference";
