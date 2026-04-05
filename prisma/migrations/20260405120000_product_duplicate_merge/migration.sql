-- Нормалізована назва для пошуку дублікатів; посилання на канонічну картку з іншого джерела
ALTER TABLE "products" ADD COLUMN "name_norm_key" TEXT;
ALTER TABLE "products" ADD COLUMN "merged_into_product_id" TEXT;

CREATE INDEX "products_name_norm_key_idx" ON "products"("name_norm_key");
CREATE INDEX "products_merged_into_product_id_idx" ON "products"("merged_into_product_id");

ALTER TABLE "products" ADD CONSTRAINT "products_merged_into_product_id_fkey"
  FOREIGN KEY ("merged_into_product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
