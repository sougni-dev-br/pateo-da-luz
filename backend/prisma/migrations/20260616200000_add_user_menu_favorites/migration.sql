-- CreateTable
CREATE TABLE "UserMenuFavorite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "menuKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMenuFavorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMenuFavorite_userId_idx" ON "UserMenuFavorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserMenuFavorite_userId_menuKey_key" ON "UserMenuFavorite"("userId", "menuKey");

-- AddForeignKey
ALTER TABLE "UserMenuFavorite" ADD CONSTRAINT "UserMenuFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
