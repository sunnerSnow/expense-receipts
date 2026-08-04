ALTER TABLE "export_batches" ADD COLUMN "image_zip_path" text;--> statement-breakpoint
ALTER TABLE "export_batches" ADD COLUMN "receipt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "export_batches" ADD COLUMN "currency_totals" jsonb;