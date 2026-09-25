-- Мітки в адмінці (етап 3).
-- tags.manual: мітку створено/відредаговано вручну — seed не перезаписує її назву, групу, опис і порядок із таксономії.
ALTER TABLE "tags" ADD COLUMN "manual" BOOLEAN NOT NULL DEFAULT false;
-- products.tags_manual: мітки товару задано вручну — імпорт прайсів їх не чіпає.
ALTER TABLE "products" ADD COLUMN "tags_manual" BOOLEAN NOT NULL DEFAULT false;
