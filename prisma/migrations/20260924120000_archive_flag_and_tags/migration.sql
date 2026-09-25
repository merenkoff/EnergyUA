-- Прапорець «архівний товар». Усе, що вже є в БД на момент міграції (імпорт з донорів
-- et_market / in_heat / vsesezon та демо з seed), іде в архів: публічний каталог показує
-- лише товари з archived = false. Новий каталог з прайсів імпортується з archived = false.
ALTER TABLE "products" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
UPDATE "products" SET "archived" = true;
CREATE INDEX "products_archived_published_idx" ON "products"("archived", "published");

-- Ціна комплекту, одиниця ціни та примітка — з прайсів постачальників
ALTER TABLE "products" ADD COLUMN "price_kit_uah" DECIMAL(12,2);
ALTER TABLE "products" ADD COLUMN "price_unit" TEXT;
ALTER TABLE "products" ADD COLUMN "price_note" TEXT;

-- Мітки (labels): багато-до-багатьох з товарами
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_uk" TEXT NOT NULL,
    "group_slug" TEXT,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");
CREATE INDEX "tags_group_slug_sort_order_idx" ON "tags"("group_slug", "sort_order");

CREATE TABLE "product_tags" (
    "product_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("product_id","tag_id")
);

CREATE INDEX "product_tags_tag_id_idx" ON "product_tags"("tag_id");

ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
