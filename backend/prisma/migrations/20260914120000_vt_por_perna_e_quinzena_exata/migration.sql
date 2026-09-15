-- Vale-transporte: tarifas viram tabela, trajeto vira lista de pernas por sentido,
-- quinzena passa a ser exata (sem "dia de sobra" nem crédito acumulado).
--
-- Migração de dados inclusa: cada vtCommute existente vira pernas de IDA + VOLTA
-- equivalentes, para ninguém perder a configuração. Todos os funcionários têm
-- vtTripsPerDay = 2 (conferido em produção em 14/09/2026), então ida+volta cobre
-- 100% da base — se algum dia aparecer trips <> 2, ele cai como trajeto vazio e o
-- gerador avisa, que é o comportamento seguro.

-- ─── 1. Enums novos ─────────────────────────────────────────────────────────
-- (VtType.BILHETE_MENSAL vem na migration anterior, de propósito — ver o comentário lá.)
CREATE TYPE "VtDirection" AS ENUM ('IDA', 'VOLTA');
CREATE TYPE "VtFareBasis" AS ENUM ('VIAGEM', 'MENSAL');

-- ─── 2. Tabela de tarifas ───────────────────────────────────────────────────
CREATE TABLE "VtFare" (
  "id"            TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "amount"        DECIMAL(8,2) NOT NULL,
  "basis"         "VtFareBasis" NOT NULL DEFAULT 'VIAGEM',
  "sundayAmount"  DECIMAL(8,2),
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"     INTEGER NOT NULL DEFAULT 0,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VtFare_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VtFare_name_key" ON "VtFare"("name");
CREATE INDEX "VtFare_isActive_sortOrder_idx" ON "VtFare"("isActive", "sortOrder");

-- Semente a partir das tarifas que estavam fixas em PayrollSettings, preservando
-- os valores já configurados (lê a linha singleton em vez de chutar o padrão).
INSERT INTO "VtFare" ("id", "name", "amount", "basis", "sundayAmount", "sortOrder", "notes")
SELECT 'vtfare_onibus_sp', 'Ônibus SP (SPTrans)', COALESCE(s."busFare", 5.30), 'VIAGEM', 0, 1,
       'Domingão Tarifa Zero: gratuito aos domingos e em 01/01, 25/01 e 25/12.'
FROM (SELECT 1) x LEFT JOIN "PayrollSettings" s ON s."id" = 'singleton';

INSERT INTO "VtFare" ("id", "name", "amount", "basis", "sundayAmount", "sortOrder", "notes")
SELECT 'vtfare_metro_cptm', 'Metrô / CPTM', COALESCE(s."metroFare", 5.40), 'VIAGEM', NULL, 2,
       'Cobra todos os dias, inclusive domingo e feriado.'
FROM (SELECT 1) x LEFT JOIN "PayrollSettings" s ON s."id" = 'singleton';

INSERT INTO "VtFare" ("id", "name", "amount", "basis", "sundayAmount", "sortOrder", "notes")
SELECT 'vtfare_integracao_sp', 'Integração ônibus + metrô (SP)', COALESCE(s."integratedFare", 9.38), 'VIAGEM', COALESCE(s."metroFare", 5.40), 3,
       'Aos domingos a SPTrans não dá desconto de integração: paga-se a tarifa cheia do metrô.'
FROM (SELECT 1) x LEFT JOIN "PayrollSettings" s ON s."id" = 'singleton';

INSERT INTO "VtFare" ("id", "name", "amount", "basis", "sundayAmount", "isActive", "sortOrder", "notes")
SELECT 'vtfare_emtu', 'EMTU intermunicipal (Carapicuiba - SP)', 0, 'VIAGEM', NULL, false, 4,
       'INATIVA: preencha o valor da linha antes de usar. A EMTU nao tem gratuidade de domingo/feriado.'
FROM (SELECT 1) x;

INSERT INTO "VtFare" ("id", "name", "amount", "basis", "isActive", "sortOrder", "notes")
SELECT 'vtfare_bilhete_onibus', 'Bilhete Único Mensal — ônibus', COALESCE(s."monthlyPassBus", 257.53), 'MENSAL', false, 10,
       'Valor fechado no mês, independente de dias trabalhados.'
FROM (SELECT 1) x LEFT JOIN "PayrollSettings" s ON s."id" = 'singleton';

INSERT INTO "VtFare" ("id", "name", "amount", "basis", "isActive", "sortOrder", "notes")
SELECT 'vtfare_bilhete_integrado', 'Bilhete Único Mensal — integrado', COALESCE(s."monthlyPassIntegrated", 411.13), 'MENSAL', false, 11,
       'Valor fechado no mês, independente de dias trabalhados.'
FROM (SELECT 1) x LEFT JOIN "PayrollSettings" s ON s."id" = 'singleton';

-- ─── 3. Pernas do trajeto ───────────────────────────────────────────────────
CREATE TABLE "EmployeeVtLeg" (
  "id"         TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "direction"  "VtDirection" NOT NULL,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  "fareId"     TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmployeeVtLeg_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmployeeVtLeg_employeeId_idx" ON "EmployeeVtLeg"("employeeId");
CREATE INDEX "EmployeeVtLeg_fareId_idx" ON "EmployeeVtLeg"("fareId");
ALTER TABLE "EmployeeVtLeg" ADD CONSTRAINT "EmployeeVtLeg_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeVtLeg" ADD CONSTRAINT "EmployeeVtLeg_fareId_fkey"
  FOREIGN KEY ("fareId") REFERENCES "VtFare"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: vtCommute -> pernas de ida e volta.
INSERT INTO "EmployeeVtLeg" ("id", "employeeId", "direction", "sortOrder", "fareId")
SELECT md5(random()::text || e."id" || d.dir || f.ord)::text,
       e."id", d.dir::"VtDirection", f.ord, f.fare
FROM "Employee" e
CROSS JOIN (VALUES ('IDA'), ('VOLTA')) AS d(dir)
JOIN LATERAL (
  SELECT t.ord, t.fare FROM (VALUES
    ('ONIBUS',                 0, 'vtfare_onibus_sp'),
    ('METRO',                  0, 'vtfare_metro_cptm'),
    ('INTEGRADO',              0, 'vtfare_integracao_sp'),
    ('ONIBUS_METRO_SEPARADO',  0, 'vtfare_onibus_sp'),
    ('ONIBUS_METRO_SEPARADO',  1, 'vtfare_metro_cptm')
  ) AS t(commute, ord, fare)
  WHERE t.commute = e."vtCommute"::text
) f ON true
WHERE e."deletedAt" IS NULL
  AND e."vtCommute" IS NOT NULL
  AND COALESCE(e."vtTripsPerDay", 2) = 2;

-- ─── 4. Employee: tarifa mensal entra; vtCommute/trips/crédito saem ─────────
ALTER TABLE "Employee" ADD COLUMN "vtMonthlyFareId" TEXT;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_vtMonthlyFareId_fkey"
  FOREIGN KEY ("vtMonthlyFareId") REFERENCES "VtFare"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Quem usava Bilhete Único vira vtType BILHETE_MENSAL apontando para a tarifa mensal.
UPDATE "Employee" SET "vtType" = 'BILHETE_MENSAL', "vtMonthlyFareId" = 'vtfare_bilhete_onibus'
 WHERE "vtCommute"::text = 'BILHETE_MENSAL_ONIBUS';
UPDATE "Employee" SET "vtType" = 'BILHETE_MENSAL', "vtMonthlyFareId" = 'vtfare_bilhete_integrado'
 WHERE "vtCommute"::text = 'BILHETE_MENSAL_INTEGRADO';
UPDATE "VtFare" SET "isActive" = true
 WHERE "id" IN (SELECT "vtMonthlyFareId" FROM "Employee" WHERE "vtMonthlyFareId" IS NOT NULL);

ALTER TABLE "Employee" DROP COLUMN "vtCommute";
ALTER TABLE "Employee" DROP COLUMN "vtTripsPerDay";
-- Saldos de crédito do "dia de sobra": ~R$ 95 já pagos em julho/2026, baixados a
-- pedido do dono (14/09/2026). O histórico fica em PayrollItem.bufferAmount.
ALTER TABLE "Employee" DROP COLUMN "vtCreditBalance";
DROP TYPE "VtCommute";

-- ─── 5. PayrollSettings: tarifas saem, corte da quinzena entra ──────────────
ALTER TABLE "PayrollSettings" ADD COLUMN "vtSecondPeriodStartDay" INTEGER NOT NULL DEFAULT 16;
ALTER TABLE "PayrollSettings" DROP COLUMN "busFare";
ALTER TABLE "PayrollSettings" DROP COLUMN "metroFare";
ALTER TABLE "PayrollSettings" DROP COLUMN "integratedFare";
ALTER TABLE "PayrollSettings" DROP COLUMN "monthlyPassBus";
ALTER TABLE "PayrollSettings" DROP COLUMN "monthlyPassIntegrated";
ALTER TABLE "PayrollSettings" DROP COLUMN "bufferDays";
