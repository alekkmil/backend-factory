-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "locale" VARCHAR(2) NOT NULL,
    "sourcePath" VARCHAR(300) NOT NULL,
    "routeContext" JSONB,
    "encryptedFields" TEXT NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "idempotencyKeyHash" VARCHAR(64),
    "idempotencyExpiresAt" TIMESTAMPTZ(3),
    "retentionUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationOutbox" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMPTZ(3),
    "providerMessageId" VARCHAR(255),
    "lastErrorCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryRateLimitBucket" (
    "keyHash" VARCHAR(64) NOT NULL,
    "bucketType" VARCHAR(8) NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EnquiryRateLimitBucket_pkey" PRIMARY KEY ("keyHash","bucketType","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_requestId_key" ON "Enquiry"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_idempotencyKeyHash_key" ON "Enquiry"("idempotencyKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationOutbox_requestId_key" ON "NotificationOutbox"("requestId");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationOutbox_status_leaseUntil_idx" ON "NotificationOutbox"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "EnquiryRateLimitBucket_expiresAt_idx" ON "EnquiryRateLimitBucket"("expiresAt");

-- AddForeignKey
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Enquiry"("requestId") ON DELETE RESTRICT ON UPDATE CASCADE;
