-- Periodicidade minima da folga em DOMINGO, por sexo.
--
-- Mulher: a cada 2 semanas (CLT art. 386 — escala de revezamento quinzenal; o
-- TST tem anulado clausulas coletivas que tentam igualar homens e mulheres).
-- Demais: a cada 3 semanas (Lei 10.101/2000 art. 6o paragrafo unico, aplicada
-- por analogia a bares e restaurantes).
--
-- Configuravel de proposito: quem fecha esse numero na pratica e a convencao
-- coletiva da categoria, que muda todo ano.
ALTER TABLE "PayrollSettings" ADD COLUMN "dsrDomingoMulherSemanas" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "PayrollSettings" ADD COLUMN "dsrDomingoGeralSemanas" INTEGER NOT NULL DEFAULT 3;
