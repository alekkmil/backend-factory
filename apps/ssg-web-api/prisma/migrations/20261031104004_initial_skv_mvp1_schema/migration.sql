-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('bg', 'en');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('jewellery', 'loose_stone');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('draft', 'published', 'hidden');

-- CreateEnum
CREATE TYPE "SalesMode" AS ENUM ('direct_purchase', 'enquiry_only', 'archive_catalogue');

-- CreateEnum
CREATE TYPE "PriceVisibility" AS ENUM ('visible', 'hidden');

-- CreateEnum
CREATE TYPE "CompositionState" AS ENUM ('unknown', 'none', 'known');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('available', 'reserved', 'in_transit', 'blocked', 'sold');

-- CreateEnum
CREATE TYPE "LocationCode" AS ENUM ('sofia', 'nessebar');

-- CreateEnum
CREATE TYPE "FulfilmentMethod" AS ENUM ('delivery', 'store_pickup');

-- CreateEnum
CREATE TYPE "DeliveryScope" AS ENUM ('bulgaria', 'selected_localities');

-- CreateEnum
CREATE TYPE "RestrictionReason" AS ENUM ('damage', 'data_check', 'management_decision', 'other');

-- CreateEnum
CREATE TYPE "SaleChannel" AS ENUM ('online', 'store');

-- CreateEnum
CREATE TYPE "PrincipalKind" AS ENUM ('staff', 'coordinator_mailbox', 'service');

-- CreateEnum
CREATE TYPE "Permission" AS ENUM ('catalogue_read', 'catalogue_edit', 'catalogue_publish', 'media_review', 'stock_fact_write', 'payment_fact_write', 'grant_reissue');

-- CreateEnum
CREATE TYPE "MediaRole" AS ENUM ('main', 'angle', 'back_profile', 'detail', 'on_body', 'original', 'editorial');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('draft', 'rework', 'approved');

-- CreateEnum
CREATE TYPE "RevisionState" AS ENUM ('draft', 'published', 'superseded');

-- CreateEnum
CREATE TYPE "RouteState" AS ENUM ('current', 'redirect', 'gone');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('home', 'hub', 'selection', 'knowledge', 'service', 'article', 'case_study', 'press', 'author', 'guide', 'faq', 'contact');

-- CreateEnum
CREATE TYPE "PolicyKind" AS ENUM ('delivery_returns', 'terms', 'privacy', 'cookies', 'accessibility');

-- CreateEnum
CREATE TYPE "ImportState" AS ENUM ('validated', 'invalid', 'committed', 'partially_committed');

-- CreateEnum
CREATE TYPE "ImportRowState" AS ENUM ('ready', 'invalid', 'committed');

-- CreateEnum
CREATE TYPE "PaymentTiming" AS ENUM ('prepayment', 'on_receipt');

-- CreateEnum
CREATE TYPE "AttemptState" AS ENUM ('pending', 'committed', 'rejected');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('received', 'confirmed');

-- CreateEnum
CREATE TYPE "LineDecision" AS ENUM ('pending', 'accept', 'do_not_accept');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('pending', 'confirmed', 'unavailable');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'failed', 'succeeded');

-- CreateEnum
CREATE TYPE "GrantScope" AS ENUM ('customer_read', 'coordinator_process');

-- CreateEnum
CREATE TYPE "InquiryType" AS ENUM ('general', 'callback', 'similar_jewellery_creation');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('ops_order_received', 'customer_payment_received', 'customer_order_confirmed', 'customer_order_access', 'coordinator_access', 'customer_access_lookup', 'inquiry_received', 'cache_invalidate', 'stock_fact_changed');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'sent', 'failed', 'suppressed');

-- CreateTable
CREATE TABLE "Principal" (
    "id" UUID NOT NULL,
    "externalSubject" VARCHAR(255) NOT NULL,
    "kind" "PrincipalKind" NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    "permissions" "Permission"[] DEFAULT ARRAY[]::"Permission"[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Principal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DictionaryEntry" (
    "id" UUID NOT NULL,
    "group" VARCHAR(40) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "labelBg" VARCHAR(255) NOT NULL,
    "labelEn" VARCHAR(255) NOT NULL,
    "appliesTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DictionaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "code" "LocationCode" NOT NULL,
    "publicData" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" VARCHAR(3) NOT NULL,
    "allowedProductTypes" "ProductType"[] DEFAULT ARRAY[]::"ProductType"[],
    "allowedJewelleryTypeCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxOnlinePrice" DECIMAL(12,2),
    "paymentMethods" JSONB NOT NULL,
    "deliveryFeeRules" JSONB NOT NULL,
    "siteContacts" JSONB NOT NULL,
    "cookieConfig" JSONB NOT NULL,
    "coordinatorEmail" VARCHAR(320),
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "ssgId" VARCHAR(40) NOT NULL,
    "publicUrlId" BIGSERIAL NOT NULL,
    "productType" "ProductType" NOT NULL,
    "publicationStatus" "PublicationStatus" NOT NULL DEFAULT 'draft',
    "currentRevisionId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLegacyMigration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaRelease" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "versionLabel" VARCHAR(30) NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "receiptSha256" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaRelease_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRevision" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "state" "RevisionState" NOT NULL DEFAULT 'draft',
    "jewelleryTypeId" UUID,
    "materialsState" "CompositionState" NOT NULL DEFAULT 'unknown',
    "gemstonesState" "CompositionState" NOT NULL DEFAULT 'unknown',
    "salesMode" "SalesMode" NOT NULL DEFAULT 'enquiry_only',
    "priceVisibility" "PriceVisibility" NOT NULL DEFAULT 'hidden',
    "fulfilmentMethods" "FulfilmentMethod"[] DEFAULT ARRAY[]::"FulfilmentMethod"[],
    "deliveryScope" "DeliveryScope",
    "deliveryLocalityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pickupLocationCodes" "LocationCode"[] DEFAULT ARRAY[]::"LocationCode"[],
    "mediaReleaseId" UUID,
    "changeReason" "RestrictionReason",
    "changeNote" VARCHAR(2000),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProductRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "releaseId" UUID,
    "logicalImageId" VARCHAR(80) NOT NULL,
    "role" "MediaRole" NOT NULL,
    "originalPrivatePath" VARCHAR(1000),
    "derivatives" JSONB NOT NULL,
    "altBg" VARCHAR(500),
    "altEn" VARCHAR(500),
    "processedWithAi" BOOLEAN NOT NULL DEFAULT false,
    "onModelIllustrative" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'draft',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTranslation" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "name" VARCHAR(250),
    "description" TEXT,
    "slug" VARCHAR(180),
    "firstPublishedAt" TIMESTAMPTZ(3),
    "firstPublishedDate" VARCHAR(10),
    "publicationEvidence" VARCHAR(1000),
    "publicModifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProductTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionMaterial" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "finenessId" UUID,
    "goldKaratId" UUID,

    CONSTRAINT "RevisionMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionGemstone" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "gemstoneId" UUID NOT NULL,

    CONSTRAINT "RevisionGemstone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevisionImage" (
    "id" UUID NOT NULL,
    "revisionId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "RevisionImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyReference" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "sourceSystem" VARCHAR(80) NOT NULL,
    "legacyId" VARCHAR(255) NOT NULL,
    "urlBg" VARCHAR(2000),
    "urlEn" VARCHAR(2000),
    "historicalPrice" DECIMAL(12,2),
    "historicalCurrency" VARCHAR(3),
    "sourceRef" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentRecord" (
    "id" UUID NOT NULL,
    "type" "ContentType" NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "parentId" UUID,
    "authorId" UUID,
    "specialData" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicRoute" (
    "id" UUID NOT NULL,
    "path" VARCHAR(1000) NOT NULL,
    "locale" "Locale" NOT NULL,
    "state" "RouteState" NOT NULL,
    "productId" UUID,
    "contentId" UUID,
    "changedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BarcodeIdentity" (
    "barcode" VARCHAR(128) NOT NULL,
    "productId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BarcodeIdentity_pkey" PRIMARY KEY ("barcode")
);

-- CreateTable
CREATE TABLE "StockItem" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "barcode" VARCHAR(128) NOT NULL,
    "locationCode" "LocationCode" NOT NULL,
    "status" "StockStatus" NOT NULL,
    "price" DECIMAL(12,2),
    "currency" VARCHAR(3),
    "weightG" DECIMAL(12,3),
    "stoneWeightCt" DECIMAL(12,3),
    "dimensions" JSONB,
    "transferTo" "LocationCode",
    "reservationReference" VARCHAR(128),
    "version" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceRef" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockSale" (
    "id" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "channel" "SaleChannel" NOT NULL,
    "storeCode" "LocationCode",
    "documentRef" VARCHAR(255) NOT NULL,
    "soldAt" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "sellerProvenance" VARCHAR(1000),
    "sourceCode" VARCHAR(80) NOT NULL,
    "sourceEventId" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" UUID NOT NULL,
    "contentId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "title" VARCHAR(250) NOT NULL,
    "intro" VARCHAR(3000),
    "slug" VARCHAR(180),
    "sections" JSONB NOT NULL,
    "seoTitle" VARCHAR(250),
    "seoDescription" VARCHAR(1000),
    "publishedAt" TIMESTAMPTZ(3),
    "publicModifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentLink" (
    "id" UUID NOT NULL,
    "ownerContentId" UUID NOT NULL,
    "slot" VARCHAR(80) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "targetContentId" UUID,
    "targetProductId" UUID,
    "targetStoreCode" "LocationCode",
    "routeId" VARCHAR(80),
    "externalUrl" VARCHAR(2000),
    "labelBg" VARCHAR(255),
    "labelEn" VARCHAR(255),

    CONSTRAINT "ContentLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyVersion" (
    "id" UUID NOT NULL,
    "kind" "PolicyKind" NOT NULL,
    "versionLabel" VARCHAR(80) NOT NULL,
    "locale" "Locale" NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "body" TEXT NOT NULL,
    "url" VARCHAR(1000) NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "verifiedPublishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "state" "ImportState" NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportProductRow" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "ssgId" VARCHAR(40) NOT NULL,
    "productId" UUID,
    "state" "ImportRowState" NOT NULL,
    "payload" JSONB NOT NULL,
    "errors" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportProductRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "customer" JSONB NOT NULL,
    "fulfilment" JSONB NOT NULL,
    "paymentMethodCode" VARCHAR(80) NOT NULL,
    "paymentTiming" "PaymentTiming" NOT NULL,
    "itemsTotal" DECIMAL(12,2) NOT NULL,
    "deliveryFee" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "settingsVersion" INTEGER NOT NULL,
    "reviewHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3),
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "publicSnapshot" JSONB NOT NULL,
    "stockVersion" INTEGER NOT NULL,
    "productVersion" INTEGER NOT NULL,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "numberSequence" BIGSERIAL NOT NULL,
    "number" VARCHAR(40) NOT NULL,
    "guestId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "policyVersionId" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'received',
    "version" INTEGER NOT NULL DEFAULT 1,
    "customer" JSONB NOT NULL,
    "fulfilment" JSONB NOT NULL,
    "paymentMethodCode" VARCHAR(80) NOT NULL,
    "paymentTiming" "PaymentTiming" NOT NULL,
    "itemsTotal" DECIMAL(12,2) NOT NULL,
    "deliveryFee" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "originalTotal" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "termsAcceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "termsActorReference" VARCHAR(255) NOT NULL,
    "financialTermsPending" BOOLEAN NOT NULL DEFAULT false,
    "attentionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionAttempt" (
    "id" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "quoteId" UUID NOT NULL,
    "state" "AttemptState" NOT NULL DEFAULT 'pending',
    "orderId" UUID,
    "rejectionCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubmissionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reservationReference" VARCHAR(128) NOT NULL,
    "reservedLocation" "LocationCode" NOT NULL,
    "decision" "LineDecision" NOT NULL DEFAULT 'pending',
    "decisionReason" "RestrictionReason",
    "decisionNote" VARCHAR(2000),
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "type" "InquiryType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "phone" VARCHAR(40),
    "topic" VARCHAR(250) NOT NULL,
    "message" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "originRouteId" VARCHAR(80) NOT NULL,
    "productId" UUID,
    "contentId" UUID,
    "storeCode" "LocationCode",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxMessage" (
    "id" UUID NOT NULL,
    "dedupeKey" VARCHAR(255) NOT NULL,
    "kind" "JobKind" NOT NULL,
    "orderId" UUID,
    "inquiryId" UUID,
    "recipientSnapshot" VARCHAR(320),
    "locale" "Locale",
    "templateVersion" VARCHAR(80),
    "payload" JSONB NOT NULL,
    "encryptedSecret" VARCHAR(4000),
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3),
    "leaseUntil" TIMESTAMPTZ(3),
    "leaseOwner" VARCHAR(128),
    "lastError" VARCHAR(1000),
    "sentAt" TIMESTAMPTZ(3),
    "providerMessageId" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCheck" (
    "id" UUID NOT NULL,
    "lineId" UUID NOT NULL,
    "locationCode" "LocationCode" NOT NULL,
    "status" "CheckStatus" NOT NULL DEFAULT 'pending',
    "checkedById" UUID,
    "checkedAt" TIMESTAMPTZ(3),
    "note" VARCHAR(2000),
    "notificationEventId" VARCHAR(128) NOT NULL,
    "messageId" UUID,

    CONSTRAINT "StoreCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acceptance" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderVersion" INTEGER NOT NULL,
    "acceptedById" UUID NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
    "acceptedItemsSubtotal" DECIMAL(12,2) NOT NULL,
    "financialTermsPending" BOOLEAN NOT NULL,

    CONSTRAINT "Acceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceLine" (
    "id" UUID NOT NULL,
    "acceptanceId" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "internalReason" "RestrictionReason",
    "internalNote" VARCHAR(2000),

    CONSTRAINT "AcceptanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOperation" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "sourceCode" VARCHAR(80) NOT NULL,
    "externalReference" VARCHAR(255) NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "evidenceRef" VARCHAR(2000) NOT NULL,
    "factsHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "scope" "GrantScope" NOT NULL,
    "principalId" UUID,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "redeemedAt" TIMESTAMPTZ(3),
    "redeemedGuestId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessSession" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionRequest" (
    "id" UUID NOT NULL,
    "scopeKey" VARCHAR(255) NOT NULL,
    "requestId" VARCHAR(128) NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "state" "AttemptState" NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ActionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "outcome" VARCHAR(40),
    "safeError" VARCHAR(1000),

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "guestId" UUID,
    "systemActor" VARCHAR(100),
    "action" VARCHAR(100) NOT NULL,
    "subjectType" VARCHAR(80) NOT NULL,
    "subjectId" VARCHAR(255) NOT NULL,
    "reason" "RestrictionReason",
    "note" VARCHAR(2000),
    "before" JSONB,
    "after" JSONB,
    "eventKey" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLookup" (
    "id" UUID NOT NULL,
    "actionRequestId" UUID NOT NULL,
    "guestId" UUID NOT NULL,
    "encryptedInput" VARCHAR(4000) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "processedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRelatedLink" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "relatedProductId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "ProductRelatedLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Principal_externalSubject_key" ON "Principal"("externalSubject");

-- CreateIndex
CREATE UNIQUE INDEX "DictionaryEntry_group_code_key" ON "DictionaryEntry"("group", "code");

-- CreateIndex
CREATE INDEX "GuestSession_expiresAt_idx" ON "GuestSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Product_publicUrlId_key" ON "Product"("publicUrlId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_currentRevisionId_key" ON "Product"("currentRevisionId");

-- CreateIndex
CREATE INDEX "Product_publicationStatus_productType_idx" ON "Product"("publicationStatus", "productType");

-- CreateIndex
CREATE UNIQUE INDEX "Product_ssgId_key" ON "Product"("ssgId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaRelease_productId_versionLabel_key" ON "MediaRelease"("productId", "versionLabel");

-- CreateIndex
CREATE INDEX "ProductRevision_productId_state_idx" ON "ProductRevision"("productId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRevision_productId_revisionNumber_key" ON "ProductRevision"("productId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_releaseId_logicalImageId_key" ON "MediaAsset"("releaseId", "logicalImageId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTranslation_revisionId_locale_key" ON "ProductTranslation"("revisionId", "locale");

-- CreateIndex
CREATE INDEX "RevisionMaterial_revisionId_idx" ON "RevisionMaterial"("revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionGemstone_revisionId_gemstoneId_key" ON "RevisionGemstone"("revisionId", "gemstoneId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionImage_revisionId_assetId_key" ON "RevisionImage"("revisionId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "RevisionImage_revisionId_sortOrder_key" ON "RevisionImage"("revisionId", "sortOrder");

-- CreateIndex
CREATE INDEX "LegacyReference_productId_idx" ON "LegacyReference"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "LegacyReference_sourceSystem_legacyId_key" ON "LegacyReference"("sourceSystem", "legacyId");

-- CreateIndex
CREATE INDEX "ContentRecord_type_parentId_idx" ON "ContentRecord"("type", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentRecord_key_key" ON "ContentRecord"("key");

-- CreateIndex
CREATE INDEX "PublicRoute_productId_locale_idx" ON "PublicRoute"("productId", "locale");

-- CreateIndex
CREATE INDEX "PublicRoute_contentId_locale_idx" ON "PublicRoute"("contentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "PublicRoute_path_key" ON "PublicRoute"("path");

-- CreateIndex
CREATE INDEX "BarcodeIdentity_productId_idx" ON "BarcodeIdentity"("productId");

-- CreateIndex
CREATE INDEX "StockItem_productId_status_price_idx" ON "StockItem"("productId", "status", "price");

-- CreateIndex
CREATE INDEX "StockItem_locationCode_status_idx" ON "StockItem"("locationCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_barcode_key" ON "StockItem"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "StockItem_reservationReference_key" ON "StockItem"("reservationReference");

-- CreateIndex
CREATE UNIQUE INDEX "StockSale_stockItemId_key" ON "StockSale"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "StockSale_sourceCode_sourceEventId_key" ON "StockSale"("sourceCode", "sourceEventId");

-- CreateIndex
CREATE INDEX "ContentTranslation_locale_published_idx" ON "ContentTranslation"("locale", "published");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_contentId_locale_key" ON "ContentTranslation"("contentId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ContentLink_ownerContentId_slot_sortOrder_key" ON "ContentLink"("ownerContentId", "slot", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyVersion_kind_versionLabel_locale_key" ON "PolicyVersion"("kind", "versionLabel", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_actorId_requestId_key" ON "ImportBatch"("actorId", "requestId");

-- CreateIndex
CREATE INDEX "ImportProductRow_productId_idx" ON "ImportProductRow"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportProductRow_batchId_ssgId_key" ON "ImportProductRow"("batchId", "ssgId");

-- CreateIndex
CREATE INDEX "Quote_guestId_createdAt_idx" ON "Quote"("guestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_stockItemId_key" ON "QuoteLine"("quoteId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_sortOrder_key" ON "QuoteLine"("quoteId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Order_numberSequence_key" ON "Order"("numberSequence");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE INDEX "Order_guestId_createdAt_idx" ON "Order"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAttempt_orderId_key" ON "SubmissionAttempt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionAttempt_guestId_requestId_key" ON "SubmissionAttempt"("guestId", "requestId");

-- CreateIndex
CREATE INDEX "OrderLine_stockItemId_idx" ON "OrderLine"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_orderId_stockItemId_key" ON "OrderLine"("orderId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLine_orderId_sortOrder_key" ON "OrderLine"("orderId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Inquiry_guestId_requestId_key" ON "Inquiry"("guestId", "requestId");

-- CreateIndex
CREATE INDEX "OutboxMessage_status_nextAttemptAt_leaseUntil_idx" ON "OutboxMessage"("status", "nextAttemptAt", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxMessage_dedupeKey_key" ON "OutboxMessage"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCheck_lineId_key" ON "StoreCheck"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreCheck_notificationEventId_key" ON "StoreCheck"("notificationEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Acceptance_orderId_key" ON "Acceptance"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptanceLine_orderLineId_key" ON "AcceptanceLine"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "AcceptanceLine_acceptanceId_orderLineId_key" ON "AcceptanceLine"("acceptanceId", "orderLineId");

-- CreateIndex
CREATE INDEX "PaymentOperation_orderId_status_idx" ON "PaymentOperation"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOperation_sourceCode_externalReference_key" ON "PaymentOperation"("sourceCode", "externalReference");

-- CreateIndex
CREATE INDEX "AccessGrant_orderId_scope_idx" ON "AccessGrant"("orderId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "AccessGrant_tokenHash_key" ON "AccessGrant"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AccessSession_tokenHash_key" ON "AccessSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AccessSession_grantId_guestId_key" ON "AccessSession"("grantId", "guestId");

-- CreateIndex
CREATE UNIQUE INDEX "ActionRequest_scopeKey_requestId_key" ON "ActionRequest"("scopeKey", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_messageId_attemptNumber_key" ON "DeliveryAttempt"("messageId", "attemptNumber");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_createdAt_idx" ON "AuditEvent"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEvent_eventKey_key" ON "AuditEvent"("eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "AccessLookup_actionRequestId_key" ON "AccessLookup"("actionRequestId");

-- CreateIndex
CREATE INDEX "AccessLookup_processedAt_expiresAt_idx" ON "AccessLookup"("processedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelatedLink_productId_relatedProductId_key" ON "ProductRelatedLink"("productId", "relatedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRelatedLink_productId_sortOrder_key" ON "ProductRelatedLink"("productId", "sortOrder");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_currentRevisionId_fkey" FOREIGN KEY ("currentRevisionId") REFERENCES "ProductRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaRelease" ADD CONSTRAINT "MediaRelease_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_jewelleryTypeId_fkey" FOREIGN KEY ("jewelleryTypeId") REFERENCES "DictionaryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_mediaReleaseId_fkey" FOREIGN KEY ("mediaReleaseId") REFERENCES "MediaRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRevision" ADD CONSTRAINT "ProductRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "MediaRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTranslation" ADD CONSTRAINT "ProductTranslation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProductRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionMaterial" ADD CONSTRAINT "RevisionMaterial_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProductRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionMaterial" ADD CONSTRAINT "RevisionMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "DictionaryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionMaterial" ADD CONSTRAINT "RevisionMaterial_finenessId_fkey" FOREIGN KEY ("finenessId") REFERENCES "DictionaryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionMaterial" ADD CONSTRAINT "RevisionMaterial_goldKaratId_fkey" FOREIGN KEY ("goldKaratId") REFERENCES "DictionaryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionGemstone" ADD CONSTRAINT "RevisionGemstone_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProductRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionGemstone" ADD CONSTRAINT "RevisionGemstone_gemstoneId_fkey" FOREIGN KEY ("gemstoneId") REFERENCES "DictionaryEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionImage" ADD CONSTRAINT "RevisionImage_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "ProductRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevisionImage" ADD CONSTRAINT "RevisionImage_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegacyReference" ADD CONSTRAINT "LegacyReference_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecord" ADD CONSTRAINT "ContentRecord_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ContentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentRecord" ADD CONSTRAINT "ContentRecord_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "ContentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicRoute" ADD CONSTRAINT "PublicRoute_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicRoute" ADD CONSTRAINT "PublicRoute_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BarcodeIdentity" ADD CONSTRAINT "BarcodeIdentity_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_barcode_fkey" FOREIGN KEY ("barcode") REFERENCES "BarcodeIdentity"("barcode") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_locationCode_fkey" FOREIGN KEY ("locationCode") REFERENCES "Store"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockItem" ADD CONSTRAINT "StockItem_transferTo_fkey" FOREIGN KEY ("transferTo") REFERENCES "Store"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSale" ADD CONSTRAINT "StockSale_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSale" ADD CONSTRAINT "StockSale_storeCode_fkey" FOREIGN KEY ("storeCode") REFERENCES "Store"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockSale" ADD CONSTRAINT "StockSale_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLink" ADD CONSTRAINT "ContentLink_ownerContentId_fkey" FOREIGN KEY ("ownerContentId") REFERENCES "ContentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLink" ADD CONSTRAINT "ContentLink_targetContentId_fkey" FOREIGN KEY ("targetContentId") REFERENCES "ContentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLink" ADD CONSTRAINT "ContentLink_targetProductId_fkey" FOREIGN KEY ("targetProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLink" ADD CONSTRAINT "ContentLink_targetStoreCode_fkey" FOREIGN KEY ("targetStoreCode") REFERENCES "Store"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportProductRow" ADD CONSTRAINT "ImportProductRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportProductRow" ADD CONSTRAINT "ImportProductRow_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_policyVersionId_fkey" FOREIGN KEY ("policyVersionId") REFERENCES "PolicyVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionAttempt" ADD CONSTRAINT "SubmissionAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_reservedLocation_fkey" FOREIGN KEY ("reservedLocation") REFERENCES "Store"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "ContentRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_storeCode_fkey" FOREIGN KEY ("storeCode") REFERENCES "Store"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCheck" ADD CONSTRAINT "StoreCheck_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCheck" ADD CONSTRAINT "StoreCheck_locationCode_fkey" FOREIGN KEY ("locationCode") REFERENCES "Store"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCheck" ADD CONSTRAINT "StoreCheck_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCheck" ADD CONSTRAINT "StoreCheck_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acceptance" ADD CONSTRAINT "Acceptance_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acceptance" ADD CONSTRAINT "Acceptance_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceLine" ADD CONSTRAINT "AcceptanceLine_acceptanceId_fkey" FOREIGN KEY ("acceptanceId") REFERENCES "Acceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceLine" ADD CONSTRAINT "AcceptanceLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOperation" ADD CONSTRAINT "PaymentOperation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOperation" ADD CONSTRAINT "PaymentOperation_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_redeemedGuestId_fkey" FOREIGN KEY ("redeemedGuestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessSession" ADD CONSTRAINT "AccessSession_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "AccessGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessSession" ADD CONSTRAINT "AccessSession_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "OutboxMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Principal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLookup" ADD CONSTRAINT "AccessLookup_actionRequestId_fkey" FOREIGN KEY ("actionRequestId") REFERENCES "ActionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessLookup" ADD CONSTRAINT "AccessLookup_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelatedLink" ADD CONSTRAINT "ProductRelatedLink_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRelatedLink" ADD CONSTRAINT "ProductRelatedLink_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Foreign-key indexes not covered by a primary key or leading unique index.
CREATE INDEX "idx_MediaRelease_reviewedById" ON "MediaRelease" ("reviewedById");
CREATE INDEX "idx_ProductRevision_jewelleryTypeId" ON "ProductRevision" ("jewelleryTypeId");
CREATE INDEX "idx_ProductRevision_mediaReleaseId" ON "ProductRevision" ("mediaReleaseId");
CREATE INDEX "idx_ProductRevision_createdById" ON "ProductRevision" ("createdById");
CREATE INDEX "idx_MediaAsset_reviewedById" ON "MediaAsset" ("reviewedById");
CREATE INDEX "idx_RevisionMaterial_materialId" ON "RevisionMaterial" ("materialId");
CREATE INDEX "idx_RevisionMaterial_finenessId" ON "RevisionMaterial" ("finenessId");
CREATE INDEX "idx_RevisionMaterial_goldKaratId" ON "RevisionMaterial" ("goldKaratId");
CREATE INDEX "idx_RevisionGemstone_gemstoneId" ON "RevisionGemstone" ("gemstoneId");
CREATE INDEX "idx_RevisionImage_assetId" ON "RevisionImage" ("assetId");
CREATE INDEX "idx_ContentRecord_parentId" ON "ContentRecord" ("parentId");
CREATE INDEX "idx_ContentRecord_authorId" ON "ContentRecord" ("authorId");
CREATE INDEX "idx_StockItem_transferTo" ON "StockItem" ("transferTo");
CREATE INDEX "idx_StockSale_storeCode" ON "StockSale" ("storeCode");
CREATE INDEX "idx_StockSale_recordedById" ON "StockSale" ("recordedById");
CREATE INDEX "idx_ContentLink_targetContentId" ON "ContentLink" ("targetContentId");
CREATE INDEX "idx_ContentLink_targetProductId" ON "ContentLink" ("targetProductId");
CREATE INDEX "idx_ContentLink_targetStoreCode" ON "ContentLink" ("targetStoreCode");
CREATE INDEX "idx_Quote_policyVersionId" ON "Quote" ("policyVersionId");
CREATE INDEX "idx_QuoteLine_stockItemId" ON "QuoteLine" ("stockItemId");
CREATE INDEX "idx_QuoteLine_productId" ON "QuoteLine" ("productId");
CREATE INDEX "idx_QuoteLine_assetId" ON "QuoteLine" ("assetId");
CREATE INDEX "idx_Order_policyVersionId" ON "Order" ("policyVersionId");
CREATE INDEX "idx_SubmissionAttempt_quoteId" ON "SubmissionAttempt" ("quoteId");
CREATE INDEX "idx_OrderLine_productId" ON "OrderLine" ("productId");
CREATE INDEX "idx_OrderLine_assetId" ON "OrderLine" ("assetId");
CREATE INDEX "idx_OrderLine_reservedLocation" ON "OrderLine" ("reservedLocation");
CREATE INDEX "idx_OrderLine_decidedById" ON "OrderLine" ("decidedById");
CREATE INDEX "idx_Inquiry_productId" ON "Inquiry" ("productId");
CREATE INDEX "idx_Inquiry_contentId" ON "Inquiry" ("contentId");
CREATE INDEX "idx_Inquiry_storeCode" ON "Inquiry" ("storeCode");
CREATE INDEX "idx_OutboxMessage_orderId" ON "OutboxMessage" ("orderId");
CREATE INDEX "idx_OutboxMessage_inquiryId" ON "OutboxMessage" ("inquiryId");
CREATE INDEX "idx_StoreCheck_locationCode" ON "StoreCheck" ("locationCode");
CREATE INDEX "idx_StoreCheck_checkedById" ON "StoreCheck" ("checkedById");
CREATE INDEX "idx_StoreCheck_messageId" ON "StoreCheck" ("messageId");
CREATE INDEX "idx_Acceptance_acceptedById" ON "Acceptance" ("acceptedById");
CREATE INDEX "idx_PaymentOperation_recordedById" ON "PaymentOperation" ("recordedById");
CREATE INDEX "idx_AccessGrant_principalId" ON "AccessGrant" ("principalId");
CREATE INDEX "idx_AccessGrant_redeemedGuestId" ON "AccessGrant" ("redeemedGuestId");
CREATE INDEX "idx_AccessSession_guestId" ON "AccessSession" ("guestId");
CREATE INDEX "idx_AuditEvent_actorId" ON "AuditEvent" ("actorId");
CREATE INDEX "idx_AuditEvent_guestId" ON "AuditEvent" ("guestId");
CREATE INDEX "idx_AccessLookup_guestId" ON "AccessLookup" ("guestId");
CREATE INDEX "idx_ProductRelatedLink_relatedProductId" ON "ProductRelatedLink" ("relatedProductId");

CREATE UNIQUE INDEX "one_draft_per_product"
  ON "ProductRevision" ("productId") WHERE "state" = 'draft';
CREATE UNIQUE INDEX "one_current_product_route"
  ON "PublicRoute" ("productId", "locale")
  WHERE "state" = 'current' AND "productId" IS NOT NULL;
CREATE UNIQUE INDEX "one_current_content_route"
  ON "PublicRoute" ("contentId", "locale")
  WHERE "state" = 'current' AND "contentId" IS NOT NULL;
CREATE UNIQUE INDEX "one_current_policy"
  ON "PolicyVersion" ("kind", "locale") WHERE "current" = true;
CREATE UNIQUE INDEX "one_material_entry"
  ON "RevisionMaterial" (
    "revisionId",
    "materialId",
    COALESCE("finenessId", '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE FUNCTION valid_stock_dimensions(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  item record;
  dimension numeric;
BEGIN
  IF value IS NULL THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(value) <> 'object' THEN
    RETURN false;
  END IF;
  FOR item IN SELECT key, value FROM jsonb_each(value)
  LOOP
    IF item.key NOT IN ('length', 'width', 'height', 'inner_diameter', 'circumference')
      OR jsonb_typeof(item.value) <> 'string'
      OR item.value #>> '{}' !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$' THEN
      RETURN false;
    END IF;
    dimension := (item.value #>> '{}')::numeric;
    IF dimension <= 0 OR dimension > 999999999.999 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
EXCEPTION
  WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN false;
END;
$$;

ALTER TABLE "ShopSettings"
  ADD CONSTRAINT "settings_singleton"
  CHECK ("id" = 1 AND "version" > 0 AND ("maxOnlinePrice" IS NULL OR "maxOnlinePrice" > 0));
ALTER TABLE "StockItem"
  ADD CONSTRAINT "real_barcode"
  CHECK (length(btrim("barcode")) BETWEEN 1 AND 128 AND "barcode" = btrim("barcode") AND "barcode" !~ '^0+$'),
  ADD CONSTRAINT "stock_price_pair"
  CHECK (("price" IS NULL AND "currency" IS NULL) OR ("price" IS NOT NULL AND "price" > 0 AND "currency" ~ '^[A-Z]{3}$')),
  ADD CONSTRAINT "stock_reservation"
  CHECK (("status" = 'reserved' AND "reservationReference" IS NOT NULL) OR ("status" <> 'reserved' AND "reservationReference" IS NULL)),
  ADD CONSTRAINT "stock_transfer"
  CHECK (("status" = 'in_transit' AND "transferTo" IS NOT NULL AND "transferTo" <> "locationCode") OR ("status" <> 'in_transit' AND "transferTo" IS NULL)),
  ADD CONSTRAINT "stock_positive_facts"
  CHECK (("weightG" IS NULL OR "weightG" > 0) AND ("stoneWeightCt" IS NULL OR "stoneWeightCt" > 0) AND valid_stock_dimensions("dimensions"::jsonb)),
  ADD CONSTRAINT "stock_version_positive"
  CHECK ("version" > 0);
ALTER TABLE "BarcodeIdentity"
  ADD CONSTRAINT "barcode_identity_real"
  CHECK (length(btrim("barcode")) BETWEEN 1 AND 128 AND "barcode" = btrim("barcode") AND "barcode" !~ '^0+$');
ALTER TABLE "PublicRoute"
  ADD CONSTRAINT "route_one_owner"
  CHECK (num_nonnulls("productId", "contentId") = 1);
ALTER TABLE "ContentLink"
  ADD CONSTRAINT "link_one_target"
  CHECK (num_nonnulls("targetContentId", "targetProductId", "targetStoreCode", "routeId", "externalUrl") = 1),
  ADD CONSTRAINT "content_link_sort_positive"
  CHECK ("sortOrder" > 0);
ALTER TABLE "Inquiry"
  ADD CONSTRAINT "inquiry_one_context"
  CHECK (num_nonnulls("productId", "contentId", "storeCode") <= 1);
ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "one_actor"
  CHECK (num_nonnulls("actorId", "guestId", "systemActor") = 1);
ALTER TABLE "ProductRevision"
  ADD CONSTRAINT "archive_hidden"
  CHECK ("salesMode" <> 'archive_catalogue' OR "priceVisibility" = 'hidden'),
  ADD CONSTRAINT "revision_number_positive"
  CHECK ("revisionNumber" > 0),
  ADD CONSTRAINT "revision_delivery_configuration"
  CHECK (
    (NOT ('delivery' = ANY("fulfilmentMethods")) AND "deliveryScope" IS NULL AND cardinality("deliveryLocalityIds") = 0)
    OR ('delivery' = ANY("fulfilmentMethods") AND "deliveryScope" IS NOT NULL
      AND (("deliveryScope" = 'bulgaria' AND cardinality("deliveryLocalityIds") = 0)
        OR ("deliveryScope" = 'selected_localities' AND cardinality("deliveryLocalityIds") > 0)))
  );
ALTER TABLE "Product"
  ADD CONSTRAINT "product_version_positive"
  CHECK ("version" > 0);
ALTER TABLE "RevisionImage"
  ADD CONSTRAINT "revision_image_sort_positive"
  CHECK ("sortOrder" > 0);
ALTER TABLE "ProductTranslation"
  ADD CONSTRAINT "publication_precision"
  CHECK (num_nonnulls("firstPublishedAt", "firstPublishedDate") <= 1),
  ADD CONSTRAINT "publication_date_format"
  CHECK ("firstPublishedDate" IS NULL OR "firstPublishedDate" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
ALTER TABLE "Quote"
  ADD CONSTRAINT "quote_totals"
  CHECK ("itemsTotal" > 0 AND "deliveryFee" >= 0 AND "total" = "itemsTotal" + "deliveryFee"),
  ADD CONSTRAINT "quote_currency"
  CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "quote_settings_version_positive"
  CHECK ("settingsVersion" > 0);
ALTER TABLE "QuoteLine"
  ADD CONSTRAINT "quote_line_positive"
  CHECK ("unitPrice" > 0 AND "sortOrder" > 0 AND "stockVersion" > 0 AND "productVersion" > 0);
ALTER TABLE "Order"
  ADD CONSTRAINT "order_totals"
  CHECK ("itemsTotal" > 0 AND "deliveryFee" >= 0 AND "total" = "itemsTotal" + "deliveryFee" AND "originalTotal" = "total"),
  ADD CONSTRAINT "order_currency"
  CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "order_version_positive"
  CHECK ("version" > 0);
ALTER TABLE "OrderLine"
  ADD CONSTRAINT "order_line_positive"
  CHECK ("unitPrice" > 0 AND "sortOrder" > 0);
ALTER TABLE "StockSale"
  ADD CONSTRAINT "stock_sale_positive_amount"
  CHECK ("amount" > 0 AND "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "stock_sale_channel_store"
  CHECK ("channel" = 'online' OR ("channel" = 'store' AND "storeCode" IS NOT NULL));
ALTER TABLE "PaymentOperation"
  ADD CONSTRAINT "payment_positive_amount"
  CHECK ("amount" > 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "Acceptance"
  ADD CONSTRAINT "acceptance_positive_subtotal"
  CHECK ("acceptedItemsSubtotal" > 0 AND "orderVersion" > 0);
ALTER TABLE "DeliveryAttempt"
  ADD CONSTRAINT "delivery_attempt_positive_number"
  CHECK ("attemptNumber" > 0);
ALTER TABLE "StoreCheck"
  ADD CONSTRAINT "store_check_actor_consistency"
  CHECK (("status" = 'pending' AND "checkedById" IS NULL AND "checkedAt" IS NULL)
    OR ("status" <> 'pending' AND "checkedById" IS NOT NULL AND "checkedAt" IS NOT NULL));
ALTER TABLE "PolicyVersion"
  ADD CONSTRAINT "current_is_published"
  CHECK (NOT "current" OR "published");
ALTER TABLE "OutboxMessage"
  ADD CONSTRAINT "outbox_attempts_nonnegative"
  CHECK ("attempts" >= 0);
ALTER TABLE "AccessGrant"
  ADD CONSTRAINT "grant_scope_principal"
  CHECK (("scope" = 'coordinator_process' AND "principalId" IS NOT NULL)
    OR ("scope" = 'customer_read' AND "principalId" IS NULL));
ALTER TABLE "ProductRelatedLink"
  ADD CONSTRAINT "related_product_sort_positive"
  CHECK ("sortOrder" > 0);

CREATE FUNCTION guard_dictionary_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."group", NEW."code") IS DISTINCT FROM (OLD."group", OLD."code")
    AND (
      EXISTS (SELECT 1 FROM "ProductRevision" WHERE "jewelleryTypeId" = OLD.id)
      OR EXISTS (SELECT 1 FROM "RevisionMaterial" WHERE "materialId" = OLD.id OR "finenessId" = OLD.id OR "goldKaratId" = OLD.id)
      OR EXISTS (SELECT 1 FROM "RevisionGemstone" WHERE "gemstoneId" = OLD.id)
    ) THEN
    RAISE EXCEPTION 'a dictionary identity referenced by catalogue data is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "dictionary_identity_guard"
  BEFORE UPDATE ON "DictionaryEntry"
  FOR EACH ROW EXECUTE FUNCTION guard_dictionary_identity();

CREATE FUNCTION validate_product_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_type "ProductType";
  release_product uuid;
  release_approved boolean;
  translation_count integer;
  image_count integer;
BEGIN
  SELECT "productType" INTO owner_type FROM "Product" WHERE id = NEW."productId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product revision owner does not exist';
  END IF;
  IF owner_type = 'jewellery' THEN
    IF NEW."jewelleryTypeId" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "DictionaryEntry"
      WHERE id = NEW."jewelleryTypeId" AND "group" = 'jewellery_type' AND active
    ) THEN
      RAISE EXCEPTION 'jewellery revision requires an active jewellery_type dictionary entry';
    END IF;
  ELSIF NEW."jewelleryTypeId" IS NOT NULL THEN
    RAISE EXCEPTION 'loose-stone revisions cannot have a jewellery type';
  END IF;

  IF NEW."materialsState" IN ('unknown', 'none')
    AND EXISTS (SELECT 1 FROM "RevisionMaterial" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'unknown or empty material state cannot contain material rows';
  ELSIF NEW."materialsState" = 'known'
    AND NOT EXISTS (SELECT 1 FROM "RevisionMaterial" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'known material state requires material rows';
  END IF;

  IF NEW."gemstonesState" IN ('unknown', 'none')
    AND EXISTS (SELECT 1 FROM "RevisionGemstone" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'unknown or empty gemstone state cannot contain gemstone rows';
  ELSIF NEW."gemstonesState" = 'known'
    AND NOT EXISTS (SELECT 1 FROM "RevisionGemstone" WHERE "revisionId" = NEW.id) THEN
    RAISE EXCEPTION 'known gemstone state requires gemstone rows';
  END IF;

  IF NEW."mediaReleaseId" IS NOT NULL THEN
    SELECT "productId", approved INTO release_product, release_approved
    FROM "MediaRelease" WHERE id = NEW."mediaReleaseId";
    IF NOT FOUND OR release_product <> NEW."productId" THEN
      RAISE EXCEPTION 'product revision media release must belong to its product';
    END IF;
  ELSE
    release_approved := false;
  END IF;

  IF NEW.state = 'published' THEN
    IF owner_type = 'loose_stone'
      AND (NEW."gemstonesState" <> 'known' OR NOT EXISTS (
        SELECT 1 FROM "RevisionGemstone" WHERE "revisionId" = NEW.id
      )) THEN
      RAISE EXCEPTION 'published loose stones require confirmed gemstone codes';
    END IF;
    IF NOT release_approved OR NEW."mediaReleaseId" IS NULL THEN
      RAISE EXCEPTION 'published products require their approved media release';
    END IF;
    SELECT count(*) INTO translation_count
    FROM "ProductTranslation"
    WHERE "revisionId" = NEW.id
      AND "name" IS NOT NULL AND length(btrim("name")) > 0
      AND "description" IS NOT NULL AND length(btrim("description")) > 0
      AND "slug" IS NOT NULL AND length(btrim("slug")) > 0;
    IF translation_count <> 2 THEN
      RAISE EXCEPTION 'published products require complete Bulgarian and English translations';
    END IF;
    SELECT count(*) INTO image_count
    FROM "RevisionImage" ri
    JOIN "MediaAsset" ma ON ma.id = ri."assetId"
    WHERE ri."revisionId" = NEW.id
      AND ma."releaseId" = NEW."mediaReleaseId"
      AND ma."reviewStatus" = 'approved';
    IF image_count = 0 OR EXISTS (
      SELECT 1 FROM "RevisionImage" ri
      JOIN "MediaAsset" ma ON ma.id = ri."assetId"
      WHERE ri."revisionId" = NEW.id
        AND (ma."releaseId" IS DISTINCT FROM NEW."mediaReleaseId"
          OR ma."reviewStatus" <> 'approved')
    ) OR (SELECT count(*) FROM "RevisionImage" ri
      JOIN "MediaAsset" ma ON ma.id = ri."assetId"
      WHERE ri."revisionId" = NEW.id AND ma.role = 'main') <> 1
      OR NOT EXISTS (
      SELECT 1 FROM "RevisionImage" ri
      JOIN "MediaAsset" ma ON ma.id = ri."assetId"
      WHERE ri."revisionId" = NEW.id AND ri."sortOrder" = 1
        AND ma.role = 'main' AND ma."reviewStatus" = 'approved'
        AND ma."releaseId" = NEW."mediaReleaseId"
    ) THEN
      RAISE EXCEPTION 'published products require an approved main image';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "Product"
      WHERE id = NEW."productId" AND "currentRevisionId" = NEW.id AND "publicationStatus" = 'published'
    ) THEN
      RAISE EXCEPTION 'published revision must be the current revision of a published product';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM "Product" WHERE "currentRevisionId" = NEW.id
  ) THEN
    RAISE EXCEPTION 'a product current revision must be published';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_revision_integrity_guard"
  AFTER INSERT OR UPDATE ON "ProductRevision"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_product_revision();

CREATE FUNCTION validate_product_current_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."publicationStatus" = 'published' AND NEW."currentRevisionId" IS NULL THEN
    RAISE EXCEPTION 'published product requires a current revision';
  END IF;
  IF NEW."currentRevisionId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ProductRevision"
    WHERE id = NEW."currentRevisionId" AND "productId" = NEW.id AND state = 'published'
  ) THEN
    RAISE EXCEPTION 'current revision must belong to the product and be published';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "product_current_revision_guard"
  AFTER INSERT OR UPDATE ON "Product"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_product_current_revision();

CREATE FUNCTION validate_revision_image() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_id uuid;
  release_id uuid;
  asset_release_id uuid;
  revision_state "RevisionState";
  asset_status "ReviewStatus";
BEGIN
  revision_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END;
  IF TG_OP = 'DELETE' THEN
    SELECT state INTO revision_state FROM "ProductRevision" WHERE id = revision_id;
    IF revision_state = 'draft' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'images on a published revision are immutable';
  END IF;
  SELECT "mediaReleaseId", state INTO release_id, revision_state
  FROM "ProductRevision" WHERE id = revision_id;
  SELECT "releaseId", "reviewStatus" INTO asset_release_id, asset_status
  FROM "MediaAsset" WHERE id = NEW."assetId";
  IF release_id IS NULL OR asset_release_id IS DISTINCT FROM release_id THEN
    RAISE EXCEPTION 'revision image must use an asset from its selected release';
  END IF;
  IF revision_state <> 'draft' AND asset_status <> 'approved' THEN
    RAISE EXCEPTION 'published revision images must be approved';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "revision_image_integrity_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "RevisionImage"
  FOR EACH ROW EXECUTE FUNCTION validate_revision_image();

CREATE FUNCTION validate_revision_material() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_state "RevisionState";
  material_code text;
  material_group text;
  fineness_group text;
  fineness_applies text[];
  karat_group text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT state INTO revision_state FROM "ProductRevision" WHERE id = OLD."revisionId";
    IF revision_state <> 'draft' THEN
      RAISE EXCEPTION 'composition on a published revision is immutable';
    END IF;
    RETURN OLD;
  END IF;
  SELECT state INTO revision_state FROM "ProductRevision" WHERE id = NEW."revisionId";
  IF revision_state <> 'draft' THEN
    RAISE EXCEPTION 'composition on a published revision is immutable';
  END IF;
  SELECT code, "group" INTO material_code, material_group
  FROM "DictionaryEntry" WHERE id = NEW."materialId" AND active;
  IF material_group <> 'material' THEN
    RAISE EXCEPTION 'materialId must reference an active material dictionary entry';
  END IF;
  IF NEW."finenessId" IS NOT NULL THEN
    SELECT "group", "appliesTo" INTO fineness_group, fineness_applies
    FROM "DictionaryEntry" WHERE id = NEW."finenessId" AND active;
    IF fineness_group <> 'fineness' OR NOT material_code = ANY(fineness_applies) THEN
      RAISE EXCEPTION 'fineness dictionary entry does not apply to the selected material';
    END IF;
  END IF;
  IF NEW."goldKaratId" IS NOT NULL THEN
    SELECT "group" INTO karat_group FROM "DictionaryEntry"
    WHERE id = NEW."goldKaratId" AND active;
    IF material_code <> 'gold' OR karat_group <> 'gold_karat' THEN
      RAISE EXCEPTION 'gold karat applies only to gold';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "revision_material_dictionary_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "RevisionMaterial"
  FOR EACH ROW EXECUTE FUNCTION validate_revision_material();

CREATE FUNCTION validate_revision_gemstone() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_state "RevisionState";
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT state INTO revision_state FROM "ProductRevision" WHERE id = OLD."revisionId";
    IF revision_state <> 'draft' THEN
      RAISE EXCEPTION 'gemstones on a published revision are immutable';
    END IF;
    RETURN OLD;
  END IF;
  SELECT state INTO revision_state FROM "ProductRevision" WHERE id = NEW."revisionId";
  IF revision_state <> 'draft' OR NOT EXISTS (
    SELECT 1 FROM "DictionaryEntry"
    WHERE id = NEW."gemstoneId" AND "group" = 'gemstone' AND active
  ) THEN
    RAISE EXCEPTION 'gemstone rows require a draft revision and active gemstone dictionary entry';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "revision_gemstone_dictionary_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "RevisionGemstone"
  FOR EACH ROW EXECUTE FUNCTION validate_revision_gemstone();

CREATE FUNCTION validate_content_record() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."authorId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "ContentRecord" WHERE id = NEW."authorId" AND type = 'author'
  ) THEN
    RAISE EXCEPTION 'content authorId must reference an author record';
  END IF;
  IF NEW."parentId" = NEW.id THEN
    RAISE EXCEPTION 'content record cannot be its own parent';
  END IF;
  IF NEW."parentId" IS NOT NULL AND EXISTS (
    WITH RECURSIVE descendants(id) AS (
      SELECT NEW.id
      UNION ALL
      SELECT child.id FROM "ContentRecord" child
      JOIN descendants parent ON child."parentId" = parent.id
    )
    SELECT 1 FROM descendants WHERE id = NEW."parentId"
  ) THEN
    RAISE EXCEPTION 'content hierarchy cannot contain a cycle';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "content_record_integrity_guard"
  BEFORE INSERT OR UPDATE OF "parentId", "authorId" ON "ContentRecord"
  FOR EACH ROW EXECUTE FUNCTION validate_content_record();

CREATE FUNCTION validate_barcode_product_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'BarcodeIdentity' THEN
    IF EXISTS (
      SELECT 1 FROM "StockItem" WHERE barcode = NEW.barcode AND "productId" <> NEW."productId"
    ) THEN
      RAISE EXCEPTION 'barcode identity cannot be reassigned from its stock item product';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM "BarcodeIdentity"
      WHERE barcode = NEW.barcode AND "productId" = NEW."productId"
    ) THEN
      RAISE EXCEPTION 'stock item product must match its barcode identity';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW."productId" IS DISTINCT FROM OLD."productId"
      AND (EXISTS (SELECT 1 FROM "QuoteLine" WHERE "stockItemId" = OLD.id)
        OR EXISTS (SELECT 1 FROM "OrderLine" WHERE "stockItemId" = OLD.id)
        OR EXISTS (SELECT 1 FROM "StockSale" WHERE "stockItemId" = OLD.id)) THEN
      RAISE EXCEPTION 'a stock item used by an order, quote, or sale cannot be reassigned';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "barcode_identity_product_guard"
  BEFORE INSERT OR UPDATE ON "BarcodeIdentity"
  FOR EACH ROW EXECUTE FUNCTION validate_barcode_product_identity();
CREATE TRIGGER "stock_item_barcode_product_guard"
  BEFORE INSERT OR UPDATE ON "StockItem"
  FOR EACH ROW EXECUTE FUNCTION validate_barcode_product_identity();

CREATE FUNCTION validate_quote_line_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "StockItem" s
    JOIN "Product" p ON p.id = NEW."productId"
    JOIN "RevisionImage" ri ON ri."assetId" = NEW."assetId"
    JOIN "MediaAsset" ma ON ma.id = ri."assetId"
    WHERE s.id = NEW."stockItemId" AND s."productId" = NEW."productId"
      AND p."publicationStatus" = 'published'
      AND p."currentRevisionId" = ri."revisionId"
      AND ma."reviewStatus" = 'approved'
  ) THEN
    RAISE EXCEPTION 'quote line stock, product, and approved current media must agree';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "quote_line_identity_guard"
  AFTER INSERT OR UPDATE ON "QuoteLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_quote_line_identity();

CREATE FUNCTION validate_order_line_origin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Order" o
    JOIN "QuoteLine" q ON q."quoteId" = o."quoteId"
    WHERE o.id = NEW."orderId" AND q."stockItemId" = NEW."stockItemId"
      AND q."productId" = NEW."productId" AND q."assetId" = NEW."assetId"
      AND q."unitPrice" = NEW."unitPrice" AND q."publicSnapshot" = NEW.snapshot
  ) THEN
    RAISE EXCEPTION 'order line must preserve its source quote line';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "order_line_quote_origin_guard"
  AFTER INSERT OR UPDATE ON "OrderLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_order_line_origin();

CREATE FUNCTION validate_order_acceptance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_order uuid;
  acceptance_id uuid;
  order_status "OrderStatus";
  order_version integer;
  acceptance_version integer;
  line_count integer;
  accepted_count integer;
  acceptance_line_count integer;
  accepted_total numeric;
  stored_total numeric;
  terms_pending boolean;
BEGIN
  IF TG_TABLE_NAME = 'Order' THEN
    target_order := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSIF TG_TABLE_NAME = 'OrderLine' THEN
    target_order := CASE WHEN TG_OP = 'DELETE' THEN OLD."orderId" ELSE NEW."orderId" END;
  ELSIF TG_TABLE_NAME = 'Acceptance' THEN
    target_order := CASE WHEN TG_OP = 'DELETE' THEN OLD."orderId" ELSE NEW."orderId" END;
  ELSE
    SELECT "orderId" INTO target_order FROM "Acceptance"
    WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."acceptanceId" ELSE NEW."acceptanceId" END;
  END IF;
  SELECT status, version INTO order_status, order_version FROM "Order" WHERE id = target_order;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT id, "orderVersion", "acceptedItemsSubtotal", "financialTermsPending"
    INTO acceptance_id, acceptance_version, stored_total, terms_pending
  FROM "Acceptance" WHERE "orderId" = target_order;
  IF acceptance_id IS NULL THEN
    IF order_status = 'confirmed' THEN
      RAISE EXCEPTION 'confirmed order requires an acceptance record';
    END IF;
    RETURN NULL;
  END IF;
  SELECT count(*) INTO line_count FROM "OrderLine" WHERE "orderId" = target_order;
  SELECT count(*), count(*) FILTER (WHERE al.accepted),
    COALESCE(sum(ol."unitPrice") FILTER (WHERE al.accepted), 0)
    INTO acceptance_line_count, accepted_count, accepted_total
  FROM "AcceptanceLine" al
  JOIN "OrderLine" ol ON ol.id = al."orderLineId"
  WHERE al."acceptanceId" = acceptance_id AND ol."orderId" = target_order;
  IF order_status <> 'confirmed' OR acceptance_version > order_version
    OR line_count = 0 OR acceptance_line_count <> line_count OR accepted_count = 0
    OR accepted_total <> stored_total
    OR terms_pending <> (accepted_count <> line_count)
    OR EXISTS (
      SELECT 1 FROM "AcceptanceLine" al
      JOIN "OrderLine" ol ON ol.id = al."orderLineId"
      WHERE al."acceptanceId" = acceptance_id AND ol."orderId" <> target_order
    )
    OR EXISTS (
      SELECT 1 FROM "AcceptanceLine"
      WHERE "acceptanceId" = acceptance_id
        AND ((accepted AND ("internalReason" IS NOT NULL OR "internalNote" IS NOT NULL))
          OR (NOT accepted AND ("internalReason" IS NULL OR "internalNote" IS NULL
            OR length(btrim("internalNote")) = 0)))
    ) THEN
    RAISE EXCEPTION 'order acceptance must cover every original line with a valid partial-acceptance snapshot';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "order_acceptance_guard"
  AFTER INSERT OR UPDATE ON "Order"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_order_acceptance();
CREATE CONSTRAINT TRIGGER "order_line_acceptance_guard"
  AFTER INSERT OR UPDATE ON "OrderLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_order_acceptance();
CREATE CONSTRAINT TRIGGER "acceptance_integrity_guard"
  AFTER INSERT OR UPDATE ON "Acceptance"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_order_acceptance();
CREATE CONSTRAINT TRIGGER "acceptance_line_integrity_guard"
  AFTER INSERT OR UPDATE ON "AcceptanceLine"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_order_acceptance();

CREATE FUNCTION validate_stock_sale_status() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stock_id uuid;
BEGIN
  stock_id := CASE WHEN TG_TABLE_NAME = 'StockSale' THEN NEW."stockItemId" ELSE NEW.id END;
  IF EXISTS (SELECT 1 FROM "StockSale" WHERE "stockItemId" = stock_id)
    AND NOT EXISTS (SELECT 1 FROM "StockItem" WHERE id = stock_id AND status = 'sold') THEN
    RAISE EXCEPTION 'a stock item with an immutable sale fact must remain sold';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "stock_sale_status_guard"
  AFTER INSERT OR UPDATE ON "StockSale"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_stock_sale_status();
CREATE CONSTRAINT TRIGGER "stock_item_sale_status_guard"
  AFTER INSERT OR UPDATE ON "StockItem"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_stock_sale_status();

CREATE FUNCTION protect_payment_facts() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payment facts cannot be deleted';
  END IF;
  IF OLD.status = 'succeeded' AND NEW.status <> 'succeeded' THEN
    RAISE EXCEPTION 'verified successful payment cannot be downgraded';
  END IF;
  IF ROW(NEW.id, NEW."orderId", NEW."sourceCode", NEW."externalReference", NEW.amount, NEW.currency,
      NEW."occurredAt", NEW."recordedById", NEW."evidenceRef", NEW."factsHash", NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."orderId", OLD."sourceCode", OLD."externalReference", OLD.amount, OLD.currency,
      OLD."occurredAt", OLD."recordedById", OLD."evidenceRef", OLD."factsHash", OLD."createdAt") THEN
    RAISE EXCEPTION 'payment fact identity and amount are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "payment_fact_immutability_guard"
  BEFORE UPDATE OR DELETE ON "PaymentOperation"
  FOR EACH ROW EXECUTE FUNCTION protect_payment_facts();

CREATE FUNCTION protect_order_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'orders are retained as immutable commercial records';
  END IF;
  IF ROW(NEW.id, NEW."numberSequence", NEW.number, NEW."guestId", NEW."quoteId",
      NEW."policyVersionId", NEW.locale, NEW.customer, NEW.fulfilment, NEW."paymentMethodCode",
      NEW."paymentTiming", NEW."itemsTotal", NEW."deliveryFee", NEW.total, NEW."originalTotal",
      NEW.currency, NEW."termsAcceptedAt", NEW."termsActorReference", NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."numberSequence", OLD.number, OLD."guestId", OLD."quoteId",
      OLD."policyVersionId", OLD.locale, OLD.customer, OLD.fulfilment, OLD."paymentMethodCode",
      OLD."paymentTiming", OLD."itemsTotal", OLD."deliveryFee", OLD.total, OLD."originalTotal",
      OLD.currency, OLD."termsAcceptedAt", OLD."termsActorReference", OLD."createdAt") THEN
    RAISE EXCEPTION 'submitted order snapshot is immutable';
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status <> 'confirmed' THEN
    RAISE EXCEPTION 'accepted orders cannot be reopened';
  END IF;
  IF NEW.version < OLD.version OR NEW.version > OLD.version + 1 THEN
    RAISE EXCEPTION 'order version must increase by at most one';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "order_snapshot_immutability_guard"
  BEFORE UPDATE OR DELETE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION protect_order_snapshot();

CREATE FUNCTION protect_order_line_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'submitted order lines cannot be deleted';
  END IF;
  IF ROW(NEW.id, NEW."orderId", NEW."stockItemId", NEW."productId", NEW."assetId",
      NEW."sortOrder", NEW."unitPrice", NEW.snapshot, NEW."reservationReference", NEW."reservedLocation")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."orderId", OLD."stockItemId", OLD."productId", OLD."assetId",
      OLD."sortOrder", OLD."unitPrice", OLD.snapshot, OLD."reservationReference", OLD."reservedLocation") THEN
    RAISE EXCEPTION 'submitted order line snapshot is immutable';
  END IF;
  IF EXISTS (SELECT 1 FROM "AcceptanceLine" WHERE "orderLineId" = OLD.id)
    AND ROW(NEW.decision, NEW."decisionReason", NEW."decisionNote", NEW."decidedById", NEW."decidedAt")
      IS DISTINCT FROM ROW(OLD.decision, OLD."decisionReason", OLD."decisionNote", OLD."decidedById", OLD."decidedAt") THEN
    RAISE EXCEPTION 'finalized order decisions are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "order_line_snapshot_immutability_guard"
  BEFORE UPDATE OR DELETE ON "OrderLine"
  FOR EACH ROW EXECUTE FUNCTION protect_order_line_snapshot();

CREATE FUNCTION protect_quote_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'quotes are retained as immutable review snapshots';
  END IF;
  IF ROW(NEW.id, NEW."guestId", NEW."policyVersionId", NEW.locale, NEW.customer, NEW.fulfilment,
      NEW."paymentMethodCode", NEW."paymentTiming", NEW."itemsTotal", NEW."deliveryFee", NEW.total,
      NEW.currency, NEW."settingsVersion", NEW."reviewHash", NEW."expiresAt", NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."guestId", OLD."policyVersionId", OLD.locale, OLD.customer, OLD.fulfilment,
      OLD."paymentMethodCode", OLD."paymentTiming", OLD."itemsTotal", OLD."deliveryFee", OLD.total,
      OLD.currency, OLD."settingsVersion", OLD."reviewHash", OLD."expiresAt", OLD."createdAt") THEN
    RAISE EXCEPTION 'quote review snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "quote_snapshot_immutability_guard"
  BEFORE UPDATE OR DELETE ON "Quote"
  FOR EACH ROW EXECUTE FUNCTION protect_quote_snapshot();

CREATE FUNCTION reject_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "quote_line_immutability_guard"
  BEFORE UPDATE OR DELETE ON "QuoteLine"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER "acceptance_immutability_guard"
  BEFORE UPDATE OR DELETE ON "Acceptance"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER "acceptance_line_immutability_guard"
  BEFORE UPDATE OR DELETE ON "AcceptanceLine"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER "stock_sale_immutability_guard"
  BEFORE UPDATE OR DELETE ON "StockSale"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER "audit_event_immutability_guard"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE FUNCTION protect_product_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'product identities cannot be deleted';
  END IF;
  IF ROW(NEW.id, NEW."ssgId", NEW."publicUrlId", NEW."productType", NEW."isLegacyMigration", NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."ssgId", OLD."publicUrlId", OLD."productType", OLD."isLegacyMigration", OLD."createdAt") THEN
    RAISE EXCEPTION 'product identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_identity_immutability_guard"
  BEFORE UPDATE OR DELETE ON "Product"
  FOR EACH ROW EXECUTE FUNCTION protect_product_identity();

CREATE FUNCTION protect_product_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'product revisions cannot be deleted';
  END IF;
  IF OLD.state = 'draft' THEN
    IF NEW.state = 'superseded' THEN
      RAISE EXCEPTION 'a draft revision cannot be directly superseded';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'published' AND NEW.state = 'superseded'
    AND ROW(NEW.id, NEW."productId", NEW."revisionNumber", NEW."jewelleryTypeId",
      NEW."materialsState", NEW."gemstonesState", NEW."salesMode", NEW."priceVisibility",
      NEW."fulfilmentMethods", NEW."deliveryScope", NEW."deliveryLocalityIds",
      NEW."pickupLocationCodes", NEW."mediaReleaseId", NEW."changeReason", NEW."changeNote",
      NEW."createdById", NEW."createdAt", NEW."publishedAt")
      IS NOT DISTINCT FROM
      ROW(OLD.id, OLD."productId", OLD."revisionNumber", OLD."jewelleryTypeId",
      OLD."materialsState", OLD."gemstonesState", OLD."salesMode", OLD."priceVisibility",
      OLD."fulfilmentMethods", OLD."deliveryScope", OLD."deliveryLocalityIds",
      OLD."pickupLocationCodes", OLD."mediaReleaseId", OLD."changeReason", OLD."changeNote",
      OLD."createdById", OLD."createdAt", OLD."publishedAt") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'published product revision content is immutable';
END;
$$;
CREATE TRIGGER "product_revision_immutability_guard"
  BEFORE UPDATE OR DELETE ON "ProductRevision"
  FOR EACH ROW EXECUTE FUNCTION protect_product_revision();

CREATE FUNCTION protect_product_translation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  revision_state "RevisionState";
BEGIN
  SELECT state INTO revision_state FROM "ProductRevision"
  WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."revisionId" ELSE NEW."revisionId" END;
  IF revision_state <> 'draft' THEN
    RAISE EXCEPTION 'translations on a published revision are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "product_translation_immutability_guard"
  BEFORE UPDATE OR DELETE ON "ProductTranslation"
  FOR EACH ROW EXECUTE FUNCTION protect_product_translation();

CREATE FUNCTION protect_media_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.approved THEN
    RAISE EXCEPTION 'approved media releases are immutable and retained';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "media_release_immutability_guard"
  BEFORE UPDATE OR DELETE ON "MediaRelease"
  FOR EACH ROW EXECUTE FUNCTION protect_media_release();

CREATE FUNCTION protect_media_asset() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  asset_id uuid;
  asset_release uuid;
  target_release uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    asset_id := NEW.id;
    target_release := NEW."releaseId";
  ELSE
    asset_id := OLD.id;
    asset_release := OLD."releaseId";
  END IF;
  IF TG_OP = 'UPDATE' THEN
    target_release := NEW."releaseId";
  END IF;
  IF (asset_release IS NOT NULL AND EXISTS (
      SELECT 1 FROM "MediaRelease" WHERE id = asset_release AND approved
    )) OR (target_release IS NOT NULL AND EXISTS (
      SELECT 1 FROM "MediaRelease" WHERE id = target_release AND approved
    )) OR EXISTS (
      SELECT 1 FROM "RevisionImage" ri
      JOIN "ProductRevision" pr ON pr.id = ri."revisionId"
      WHERE ri."assetId" = asset_id AND pr.state <> 'draft'
    ) THEN
    RAISE EXCEPTION 'approved or published media assets are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "media_asset_immutability_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "MediaAsset"
  FOR EACH ROW EXECUTE FUNCTION protect_media_asset();

CREATE FUNCTION protect_policy_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'policy versions are retained';
  END IF;
  IF ROW(NEW.id, NEW.kind, NEW."versionLabel", NEW.locale, NEW.title, NEW.body, NEW.url, NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD.kind, OLD."versionLabel", OLD.locale, OLD.title, OLD.body, OLD.url, OLD."createdAt") THEN
    RAISE EXCEPTION 'policy version text and identity are immutable';
  END IF;
  IF OLD.published AND (NOT NEW.published OR NEW."verifiedPublishedAt" IS DISTINCT FROM OLD."verifiedPublishedAt") THEN
    RAISE EXCEPTION 'published policy evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "policy_version_immutability_guard"
  BEFORE UPDATE OR DELETE ON "PolicyVersion"
  FOR EACH ROW EXECUTE FUNCTION protect_policy_version();

CREATE FUNCTION protect_barcode_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'barcode identities cannot be updated or deleted';
END;
$$;
CREATE TRIGGER "barcode_identity_immutability_guard"
  BEFORE UPDATE OR DELETE ON "BarcodeIdentity"
  FOR EACH ROW EXECUTE FUNCTION protect_barcode_identity();

CREATE FUNCTION protect_stock_item_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'physical stock records cannot be deleted';
  END IF;
  IF ROW(NEW.id, NEW."productId", NEW.barcode, NEW."createdAt")
    IS DISTINCT FROM ROW(OLD.id, OLD."productId", OLD.barcode, OLD."createdAt") THEN
    RAISE EXCEPTION 'stock item product and barcode identity are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "stock_item_identity_immutability_guard"
  BEFORE UPDATE OR DELETE ON "StockItem"
  FOR EACH ROW EXECUTE FUNCTION protect_stock_item_identity();

CREATE FUNCTION protect_public_route_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'public route history cannot be deleted';
  END IF;
  IF ROW(NEW.id, NEW.path, NEW.locale, NEW."productId", NEW."contentId", NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD.path, OLD.locale, OLD."productId", OLD."contentId", OLD."createdAt") THEN
    RAISE EXCEPTION 'public route path and owner are immutable';
  END IF;
  IF OLD.state <> NEW.state AND NOT (OLD.state = 'current' AND NEW.state IN ('redirect', 'gone')) THEN
    RAISE EXCEPTION 'public route state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "public_route_immutability_guard"
  BEFORE UPDATE OR DELETE ON "PublicRoute"
  FOR EACH ROW EXECUTE FUNCTION protect_public_route_identity();

ALTER TABLE "ProductRelatedLink"
  ADD CONSTRAINT "related_product_not_self"
  CHECK ("productId" <> "relatedProductId");

ALTER TABLE "SubmissionAttempt"
  ADD CONSTRAINT "submission_payload_hash"
  CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Inquiry"
  ADD CONSTRAINT "inquiry_payload_hash"
  CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ImportBatch"
  ADD CONSTRAINT "import_payload_hash"
  CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "ActionRequest"
  ADD CONSTRAINT "action_payload_hash"
  CHECK ("payloadHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "GuestSession"
  ADD CONSTRAINT "guest_token_hash"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "AccessGrant"
  ADD CONSTRAINT "grant_token_hash"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "AccessSession"
  ADD CONSTRAINT "access_session_token_hash"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "PaymentOperation"
  ADD CONSTRAINT "payment_facts_hash"
  CHECK ("factsHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "MediaRelease"
  ADD CONSTRAINT "media_receipt_hash"
  CHECK ("receiptSha256" IS NULL OR "receiptSha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "OrderLine"
  ADD CONSTRAINT "order_line_decision_fields"
  CHECK (
    (decision = 'pending' AND "decisionReason" IS NULL AND "decisionNote" IS NULL
      AND "decidedById" IS NULL AND "decidedAt" IS NULL)
    OR (decision = 'accept' AND "decisionReason" IS NULL AND "decisionNote" IS NULL
      AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
    OR (decision = 'do_not_accept' AND "decisionReason" IS NOT NULL
      AND "decisionNote" IS NOT NULL AND length(btrim("decisionNote")) > 0
      AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
  );


-- Initial dictionary seed: MVP1 v1.1 (153 values).
INSERT INTO "DictionaryEntry" (id, "group", code, "labelBg", "labelEn", "appliesTo", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'product_type', 'jewellery', 'Бижу', 'Jewellery', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'product_type', 'loose_stone', 'Самостоятелен камък', 'Loose gemstone', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'ring', 'Пръстен', 'Ring', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'earrings', 'Обеци', 'Earrings', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'pendant', 'Медальон', 'Pendant', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'cross', 'Кръст', 'Cross', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'chain', 'Синджир', 'Chain', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'necklace', 'Колие', 'Necklace', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'bracelet', 'Гривна', 'Bracelet', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'brooch', 'Брошка', 'Brooch', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'piercing', 'Пиърсинг', 'Body jewellery', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'hair_clip', 'Шнола', 'Hair clip', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'wedding_band', 'Венчална халка', 'Wedding band', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'set', 'Комплект', 'Set', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'cufflinks', 'Ръкавели', 'Cufflinks', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'prayer_beads', 'Броеница', 'Prayer beads', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'anklet', 'Гривна за крак', 'Anklet', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'jewellery_type', 'engagement_ring', 'Годежен пръстен', 'Engagement ring', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'gold', 'Злато', 'Gold', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'silver', 'Сребро', 'Silver', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'platinum', 'Платина', 'Platinum', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'titanium', 'Титан', 'Titanium', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'steel', 'Стомана', 'Steel', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'brass', 'Месинг', 'Brass', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'aluminium', 'Алуминий', 'Aluminium', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'horn', 'Рог', 'Horn', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'wood', 'Дърво', 'Wood', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'leather', 'Кожа', 'Leather', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'enamel', 'Емайл', 'Enamel', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'ivory', 'Слонова кост', 'Ivory', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'ebony', 'Абанос', 'Ebony', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'material', 'silk_thread', 'Копринен конец', 'Silk thread', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_333', '333 ‰', '333 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_375', '375 ‰', '375 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_416_66', '416.66 ‰', '416.66 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_585', '585 ‰', '585 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_750', '750 ‰', '750 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_916_66', '916.66 ‰', '916.66 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_950', '950 ‰', '950 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'gold_999', '999 ‰', '999 ‰', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'silver_800', '800 ‰', '800 ‰', ARRAY['material.silver']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'silver_900', '900 ‰', '900 ‰', ARRAY['material.silver']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'silver_925', '925 ‰', '925 ‰', ARRAY['material.silver']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'silver_950', '950 ‰', '950 ‰', ARRAY['material.silver']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'silver_999', '999 ‰', '999 ‰', ARRAY['material.silver']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'platinum_850', '850 ‰', '850 ‰', ARRAY['material.platinum']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'platinum_900', '900 ‰', '900 ‰', ARRAY['material.platinum']::text[], now(), now()),
  (gen_random_uuid(), 'fineness', 'platinum_950', '950 ‰', '950 ‰', ARRAY['material.platinum']::text[], now(), now()),
  (gen_random_uuid(), 'gold_karat', '8', '8 карата', '8 karat', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'gold_karat', '9', '9 карата', '9 karat', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'gold_karat', '10', '10 карата', '10 karat', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'gold_karat', '14', '14 карата', '14 karat', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'gold_karat', '18', '18 карата', '18 karat', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'gold_karat', '22', '22 карата', '22 karat', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'gold_karat', '24', '24 карата', '24 karat', ARRAY['material.gold']::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'agate', 'Ахат', 'Agate', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'alexandrite', 'Александрит', 'Alexandrite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'amethyst', 'Аметист', 'Amethyst', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'amber', 'Кехлибар', 'Amber', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'amazonite', 'Амазонит', 'Amazonite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'aquamarine', 'Аквамарин', 'Aquamarine', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'aragonite', 'Арагонит', 'Aragonite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'aventurine', 'Авантюрин', 'Aventurine', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'azurmalachite', 'Азурмалахит', 'Azurmalachite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'carnelian', 'Карнеол', 'Carnelian', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'charoite', 'Чароит', 'Charoite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'coral', 'Корал', 'Coral', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'citrine', 'Цитрин', 'Citrine', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'diamond', 'Диамант', 'Diamond', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'emerald', 'Изумруд', 'Emerald', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'epidote', 'Епидот', 'Epidote', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'fossil', 'Фосил', 'Fossil', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'garnet', 'Гранат', 'Garnet', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'chalcedony', 'Халцедон', 'Chalcedony', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'hematite', 'Хематит', 'Hematite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'chrysoprase', 'Хризопраз', 'Chrysoprase', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'iolite', 'Иолит', 'Iolite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'jasper', 'Яспис', 'Jasper', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'kyanite', 'Кианит', 'Kyanite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'kunzite', 'Кунцит', 'Kunzite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'labradorite', 'Лабрадорит', 'Labradorite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'lazurite', 'Лазурит', 'Lazurite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'lapis_lazuli', 'Лапис лазули', 'Lapis lazuli', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'malachite', 'Малахит', 'Malachite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'marcasite', 'Марказит', 'Marcasite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'morganite', 'Морганит', 'Morganite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'rock_crystal', 'Планински кристал', 'Rock crystal', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'moonstone', 'Лунен камък', 'Moonstone', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'obsidian', 'Обсидиан', 'Obsidian', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'onyx', 'Оникс', 'Onyx', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'opal', 'Опал', 'Opal', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'pearl', 'Перла', 'Pearl', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'peridot', 'Перидот', 'Peridot', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'prehnite', 'Пренит', 'Prehnite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'rose_quartz', 'Розов кварц', 'Rose quartz', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'rutilated_quartz', 'Рутилов кварц', 'Rutilated quartz', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'tourmalinated_quartz', 'Кварц с турмалин', 'Tourmalinated quartz', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'quartz', 'Кварц', 'Quartz', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'ruby', 'Рубин', 'Ruby', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'ruby_zoisite', 'Рубин в цоизит', 'Ruby in zoisite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'rhodolite', 'Родолит', 'Rhodolite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'rubellite', 'Рубелит', 'Rubellite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'sapphire', 'Сапфир', 'Sapphire', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'mother_of_pearl', 'Седеф', 'Mother of pearl', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'septarian', 'Септария', 'Septarian', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'serpentinite', 'Серпентинит', 'Serpentinite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'sodalite', 'Содалит', 'Sodalite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'spinel', 'Шпинел', 'Spinel', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'sunstone', 'Слънчев камък', 'Sunstone', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'tanzanite', 'Танзанит', 'Tanzanite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'turquoise', 'Тюркоаз', 'Turquoise', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'tsavorite', 'Цаворит', 'Tsavorite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'tourmaline', 'Турмалин', 'Tourmaline', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'tigers_eye', 'Тигрово око', 'Tiger’s eye', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'topaz', 'Топаз', 'Topaz', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'zircon', 'Циркон', 'Zircon', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'fluorite', 'Флуорит', 'Fluorite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'chrysoberyl', 'Хризоберил', 'Chrysoberyl', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'ametrine', 'Аметрин', 'Ametrine', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'chrome_diopside', 'Хромдиопсид', 'Chrome diopside', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'apatite', 'Апатит', 'Apatite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'lava_stone', 'Лава', 'Lava stone', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'sphene', 'Титанит (сфен)', 'Sphene (titanite)', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'beryl', 'Берил', 'Beryl', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'diopside', 'Диопсид', 'Diopside', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'larimar', 'Ларимар', 'Larimar', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'prasiolite', 'Празиолит', 'Prasiolite', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'gemstone', 'smoky_quartz', 'Пушен кварц', 'Smoky quartz', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'stock_status', 'available', 'Наличен', 'Available', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'stock_status', 'reserved', 'Резервиран', 'Reserved', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'stock_status', 'in_transit', 'В трансфер', 'In transit', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'stock_status', 'blocked', 'Спрян', 'Blocked', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'stock_status', 'sold', 'Продаден', 'Sold', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'stock_location', 'sofia', 'София', 'Sofia', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'stock_location', 'nessebar', 'Несебър', 'Nessebar', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'publication_status', 'draft', 'Чернова', 'Draft', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'publication_status', 'published', 'Публикуван', 'Published', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'publication_status', 'hidden', 'Скрит', 'Hidden', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'sales_mode', 'direct_purchase', 'Директна покупка', 'Direct purchase', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'sales_mode', 'enquiry_only', 'Само запитване', 'Enquiry only', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'sales_mode', 'archive_catalogue', 'Архивен каталог', 'Archive catalogue', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'price_visibility', 'visible', 'Показана цена', 'Price shown', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'price_visibility', 'hidden', 'Скрита цена', 'Price hidden', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'restriction_reason', 'damage', 'Повреда', 'Damage', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'restriction_reason', 'data_check', 'Проверка на данни', 'Data verification', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'restriction_reason', 'management_decision', 'Решение на управител', 'Management decision', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'restriction_reason', 'other', 'Друга причина', 'Other reason', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'sale_channel', 'online', 'Онлайн', 'Online', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'sale_channel', 'store', 'Магазин', 'In store', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'delivery_scope', 'bulgaria', 'Цяла България', 'All of Bulgaria', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'delivery_scope', 'selected_localities', 'Избрани населени места', 'Selected localities', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'fulfilment_method', 'delivery', 'Доставка', 'Delivery', ARRAY[]::text[], now(), now()),
  (gen_random_uuid(), 'fulfilment_method', 'store_pickup', 'Получаване от магазин', 'Store pickup', ARRAY[]::text[], now(), now())
ON CONFLICT ("group", code) DO NOTHING;
