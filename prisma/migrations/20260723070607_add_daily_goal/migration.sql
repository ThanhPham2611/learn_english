-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "overallLevel" TEXT NOT NULL DEFAULT 'A2',
    "listening" TEXT,
    "reading" TEXT,
    "writing" TEXT,
    "speaking" TEXT,
    "placementDone" BOOLEAN NOT NULL DEFAULT false,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "dailyGoal" INTEGER NOT NULL DEFAULT 3,
    "lastStudyDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Profile" ("createdAt", "id", "lastStudyDate", "listening", "overallLevel", "placementDone", "reading", "speaking", "streak", "updatedAt", "writing") SELECT "createdAt", "id", "lastStudyDate", "listening", "overallLevel", "placementDone", "reading", "speaking", "streak", "updatedAt", "writing" FROM "Profile";
DROP TABLE "Profile";
ALTER TABLE "new_Profile" RENAME TO "Profile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
