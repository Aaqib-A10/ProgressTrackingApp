-- CreateTable
CREATE TABLE "SentMonthlyReport" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentMonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SentMonthlyReport_month_department_key" ON "SentMonthlyReport"("month", "department");
