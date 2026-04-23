-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Conversion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "orderTotal" REAL NOT NULL,
    "affiliatePayout" REAL NOT NULL,
    "appFee" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "billingChargeId" TEXT,
    "processedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "affiliateId" TEXT NOT NULL,
    CONSTRAINT "Conversion_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Conversion" ("affiliateId", "affiliatePayout", "appFee", "createdAt", "id", "orderId", "orderName", "orderTotal", "shop", "status") SELECT "affiliateId", "affiliatePayout", "appFee", "createdAt", "id", "orderId", "orderName", "orderTotal", "shop", "status" FROM "Conversion";
DROP TABLE "Conversion";
ALTER TABLE "new_Conversion" RENAME TO "Conversion";
CREATE UNIQUE INDEX "Conversion_shop_orderId_key" ON "Conversion"("shop", "orderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
