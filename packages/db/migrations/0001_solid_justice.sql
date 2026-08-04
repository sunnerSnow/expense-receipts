ALTER TABLE "receipts" ADD COLUMN "recognition_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "recognition_error" text;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "recognition_warnings" jsonb;