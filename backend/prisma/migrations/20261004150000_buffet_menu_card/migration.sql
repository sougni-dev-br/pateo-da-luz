-- Cardápio do evento para o display de acrílico (frente e verso).

CREATE TABLE "BuffetMenuCard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventDate" DATE,
    "theme" TEXT NOT NULL DEFAULT 'wine',
    "faceWidthMm" INTEGER NOT NULL DEFAULT 92,
    "faceHeightMm" INTEGER NOT NULL DEFAULT 76,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuffetMenuCard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuffetMenuCard_updatedAt_idx" ON "BuffetMenuCard"("updatedAt");

-- Modelo: o cardápio de 26/09/2025 da planilha "Placas de acrílico", com nomes padronizados e inglês.
INSERT INTO "BuffetMenuCard" ("id", "name", "eventDate", "theme", "faceWidthMm", "faceHeightMm", "copies", "sections", "updatedAt") VALUES
  ('f5d8680e-b2d8-524a-a8e0-7b4ee727c200', 'Cardápio do evento 26/09/2025', '2025-09-26', 'wine', 92, 76, 2, '[{"face": "front", "titlePt": "Antepastos", "titleEn": "Antipasti", "items": [{"namePt": "Pão especial da casa, guacamole e pasta de grão-de-bico", "nameEn": "House special bread, guacamole and chickpea spread"}]}, {"face": "front", "titlePt": "Entradas", "titleEn": "Starters", "items": [{"namePt": "Saladinha do Pateo", "nameEn": "Pateo side salad"}, {"namePt": "Ceviche de peixe branco", "nameEn": "White fish ceviche"}]}, {"face": "back", "titlePt": "Pratos à la carte", "titleEn": "À la carte main courses", "items": [{"namePt": "Bife ancho grelhado ao chimichurri com batatas fritas e Arroz Biro Biro", "nameEn": "Grilled rib eye steak with chimichurri, fries and Biro Biro rice"}, {"namePt": "Escalope de mignon em redução de vinho tinto com batatas rústicas", "nameEn": "Filet mignon escalope in red wine reduction with rustic potatoes"}, {"namePt": "Salmão grelhado ao molho de alcaparras com risoto de alho-poró", "nameEn": "Grilled salmon with caper sauce and leek risotto"}, {"namePt": "Saint Peter à milanesa com risoto al limone", "nameEn": "Breaded Saint Peter fish with risotto al limone"}, {"namePt": "Nhoque ao ragu de ossobuco", "nameEn": "Gnocchi with ossobuco ragù"}, {"namePt": "Risoto de funghi", "nameEn": "Funghi risotto"}]}, {"face": "back", "titlePt": "Sobremesas", "titleEn": "Desserts", "items": [{"namePt": "Pudim de leite, especialidade da casa", "nameEn": "Brazilian milk pudding, house specialty"}, {"namePt": "Abacaxi com raspas de limão", "nameEn": "Pineapple with lime zest"}]}]'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
