SELECT 'TABLES' AS check, table_name AS value FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('TaxPayment','TaxPaymentAttachment') ORDER BY table_name;
SELECT 'ENUMS' AS check, typname AS value FROM pg_type WHERE typname IN ('TaxPaymentStatus','TaxPaymentSource') ORDER BY typname;
SELECT 'INDEXES' AS check, indexname AS value FROM pg_indexes WHERE tablename='TaxPayment' ORDER BY indexname;
SELECT 'COUNT_TP' AS check, COUNT(*)::text AS value FROM "TaxPayment";
SELECT 'COUNT_ATT' AS check, COUNT(*)::text AS value FROM "TaxPaymentAttachment";
