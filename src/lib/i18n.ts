// UI strings. Small enough that a dictionary beats pulling in an i18n library.
// Server-side error text (upload limits, missing key) still comes back from the
// API in English — those would need the language sent with the request.

export type Lang = "en" | "tr"

export const LANGS: Lang[] = ["en", "tr"]
export const LANG_LABEL: Record<Lang, string> = { en: "EN", tr: "TR" }

/** Money and dates should follow the chosen language, not the browser. */
export function localeFor(lang: Lang): string {
  return lang === "tr" ? "tr-TR" : "en-US"
}

const en = {
  loading: "Loading…",

  // gate
  gate_kicker: "docsheet",
  gate_title: "Private workspace",
  gate_hint: "Enter the password to continue.",
  gate_unlock: "Unlock",
  gate_unlocking: "Unlocking…",
  gate_wrong: "Wrong password.",

  // header / footer
  nav_github: "docsheet on GitHub",
  lang_switch: "Switch language",
  footer_note: "files are streamed to OpenRouter for OCR and never stored.",
  footer_tag: "OCR → Excel / CSV",

  // hero
  hero_kicker: "PDF & image → spreadsheet",
  hero_title_lead: "Turn documents into spreadsheets",
  hero_body:
    "Drop a stack of PDFs or photos — the best OCR models pull out every table, check the totals add up, and stack them into one sheet you can download as Excel, CSV, or JSON. Already have a spreadsheet? Drop that in instead and go straight to the barcode matcher.",
  lock: "Lock",

  // key warning
  no_key_title: "No OpenRouter key set.",
  no_key_body: "Extraction needs {code} on the server.",
  no_key_sheets: "Reading spreadsheets and matching barcodes work without it.",

  // dropzone + queue
  drop_first: "Drop PDFs or images, or click to browse",
  drop_more: "Add more documents",
  drop_types: "PDF · PNG · JPG · WEBP · TIFF · XLSX · CSV · max 25 MB each",
  drop_sheet_note:
    "Already have a spreadsheet? Drop the .xlsx or .csv straight in — it skips the model and goes to the matcher.",
  sheet_badge: "spreadsheet",
  sheet_read_one: "Read spreadsheet",
  sheet_read_many: "Read {n} spreadsheets",
  sheet_reading: "Reading…",
  queue_count_one: "{n} document",
  queue_count_many: "{n} documents",
  queue_clear: "Clear all",
  queue_remove: "Remove {name}",
  totals_ok: "totals ✓",
  totals_bad: "totals ✕",

  // quality
  quality: "Quality",
  tier_fast_label: "Fast",
  tier_fast_blurb: "Quick & cheap — great for clean digital docs",
  tier_balanced_label: "Balanced",
  tier_balanced_blurb: "Best accuracy-for-price — the sweet spot",
  tier_best_label: "Best",
  tier_best_blurb: "Highest accuracy — messy scans & dense tables",
  tier_price: "≈ ${price} / 1M input tokens",

  // advanced
  advanced: "Advanced options",
  custom_model: "Custom model id",
  pdf_engine: "PDF engine",
  engine_auto: "Auto — free text layer, OCR fallback for scans (recommended)",
  engine_mistral: "Mistral OCR — best for scans/photos ($2 / 1k pages)",
  engine_native: "Model native — the model reads the PDF itself",
  engine_pdf_text: "PDF text — free, digital (text) PDFs only",
  engine_used_text: "text layer · free",
  engine_used_ocr: "Mistral OCR",
  engine_used_native: "native",

  // run
  extract_one: "Extract tables",
  extract_many: "Extract {n} documents",
  extracting: "Extracting…",
  status_done: "{n} done · {rows} rows",

  // results
  combined: "Combined",
  layout: "Your layout",
  use_in_combined: "Use in Combined",
  in_combined: "In Combined",
  columns: "Columns",
  columns_title: "Column layout",
  columns_hint:
    "Rename, reorder or switch off columns — the layout is remembered for next time, so the order your stock program wants only has to be set up once.",
  columns_reset: "Reset to detected",
  columns_include: "Include {name}",
  columns_rename: "Rename {name}",
  columns_move_up: "Move {name} up",
  columns_move_down: "Move {name} down",
  rows_one: "{n} row.",
  rows_many: "{n} rows.",
  rows_truncated: "Showing first {n} of {total} rows — the download has them all.",
  csv_note: " CSV saves this sheet only; Excel saves all of them.",
  copy_note: "Copy puts every row on the clipboard, ready to paste into an open sheet.",
  copy: "Copy",
  copied: "Copied",
  preparing: "Preparing…",

  // barcode matcher
  matcher_title: "Barcode → name",
  matcher_subtitle:
    "Fill in the product names your supplier left out, by matching the barcode column against a catalog.",
  matcher_enable: "On",
  matcher_no_column: "No barcode column found in this sheet.",
  matcher_off: "Switched off — the sheets show exactly what the model read.",
  matcher_matched: "{matched} of {rows} barcode rows named",
  matcher_priced: "{n} priced",
  matcher_priced_none: "no shelf price published",
  matcher_price_hint:
    "None of these products were published with a price. Paste your own price list below — barcode, name and price, one product per line — and every sheet after this one is priced too.",
  matcher_repaired_one: "{n} misread barcode corrected",
  matcher_repaired_many: "{n} misread barcodes corrected",
  matcher_unmatched: "{n} unmatched",
  matcher_unmatched_hint:
    "Nothing knows these codes yet. Look them up online, or paste them into your own list below.",
  matcher_catalog_size_one: "{n} product in the catalog",
  matcher_catalog_size_many: "{n} products in the catalog",
  matcher_sources: "Sources",
  matcher_all: "Use all sources",
  matcher_own: "Your list",
  matcher_own_blurb:
    "Paste or import barcode, name and shelf price. Beats every other source — and it is the only source that can price a medicine.",
  matcher_own_toggle: "Use your own list",
  matcher_own_count_one: "{n} product",
  matcher_own_count_many: "{n} products",
  matcher_own_priced: "{n} priced",
  matcher_own_skipped_one: "{n} line skipped",
  matcher_own_skipped_many: "{n} lines skipped",
  matcher_shop_blurb: "Every product published on {site}, read straight from the shop.",
  matcher_shop_toggle: "Use the {name} catalog",
  matcher_shop_count: "{n} loaded",
  matcher_add_shop: "Add another shop",
  matcher_add_shop_hint:
    "Any shop that publishes its products with barcodes works — the server reads the shop’s own sitemap and product data. Public https sites only.",
  matcher_add: "Add",
  matcher_registry_blurb:
    "Every licensed medicine in Turkey, from the drug list TİTCK republishes each week.",
  matcher_registry_no_price:
    "That list carries no prices — for a medicine's shelf price, use your own list.",
  matcher_registry_toggle: "Use the TİTCK drug registry",
  matcher_registry_count: "{n} indexed",
  matcher_sector_pharmacy: "Pharmacy",
  matcher_sector_beauty: "Beauty & personal care",
  matcher_extras: "Also add",
  matcher_extra_brand: "Manufacturer",
  matcher_extra_price: "Shelf price",
  matcher_extra_note: "ATC / category",
  matcher_loading: "Loading…",
  matcher_refresh: "Refresh",
  matcher_open: "Open databases",
  matcher_open_blurb: "Open Food Facts and Open Beauty Facts — free, worldwide, no key.",
  matcher_open_toggle: "Look codes up in the open databases automatically",
  matcher_open_auto: "Whatever the other two can’t name is looked up here automatically.",
  matcher_open_count_one: "{n} name found",
  matcher_open_count_many: "{n} names found",
  matcher_look_up_one: "Look up {n} code",
  matcher_look_up_many: "Look up {n} codes",
  matcher_looking_up: "Looking up…",
  matcher_list_label: "Your barcode list",
  matcher_list_hint:
    "One product per line — barcode, name, and the shelf price if you have it. Semicolons or tabs between them, and a heading row is read if there is one.",
  matcher_import: "Import CSV",
  matcher_clear: "Clear",
  matcher_mode: "Where the name goes",
  matcher_mode_new: "Add a new column",
  matcher_mode_fill: "Fill the blanks in the item column",
  matcher_column_label: "Column heading",
  matcher_default_label: "Product name",

  // reconciliation
  recon_ok_title: "Totals reconcile.",
  recon_ok_body: "“{column}” adds up to {sum}, matching “{label}” on the document.",
  recon_bad_title: "Totals don’t match.",
  recon_bad_body:
    "“{column}” adds up to {sum} but the document states {stated} for “{label}” — off by {delta}. Worth checking before you use this one.",

  // combined column headings
  col_source: "Source",
  col_barcode: "Barcode",
  col_code: "Code",
  col_item: "Item",
  col_quantity: "Quantity",
  col_unit: "Unit",
  col_unit_price: "Unit price",
  col_discount: "Discount",
  col_vat: "VAT",
  col_amount: "Amount",
  col_date: "Date",
}

export type StringKey = keyof typeof en

const tr: Record<StringKey, string> = {
  loading: "Yükleniyor…",

  gate_kicker: "docsheet",
  gate_title: "Özel çalışma alanı",
  gate_hint: "Devam etmek için parolayı girin.",
  gate_unlock: "Kilidi aç",
  gate_unlocking: "Açılıyor…",
  gate_wrong: "Parola yanlış.",

  nav_github: "GitHub’da docsheet",
  lang_switch: "Dili değiştir",
  footer_note: "dosyalar OCR için OpenRouter’a aktarılır, hiçbir zaman saklanmaz.",
  footer_tag: "OCR → Excel / CSV",

  hero_kicker: "PDF ve görsel → tablo",
  hero_title_lead: "Belgeleri tablolara dönüştürün",
  hero_body:
    "Bir yığın PDF veya fotoğraf bırakın — en iyi OCR modelleri her tabloyu çıkarır, toplamların tuttuğunu denetler ve hepsini Excel, CSV ya da JSON olarak indirebileceğiniz tek bir sayfada birleştirir. Elinizde tablo mu var? Onu bırakın, doğrudan barkod eşleştiriciye geçin.",
  lock: "Kilitle",

  no_key_title: "OpenRouter anahtarı tanımlı değil.",
  no_key_body: "Çıkarma işlemi için sunucuda {code} gerekir.",
  no_key_sheets: "Tablo okuma ve barkod eşleştirme bu anahtar olmadan da çalışır.",

  drop_first: "PDF veya görselleri bırakın ya da seçmek için tıklayın",
  drop_more: "Başka belge ekleyin",
  drop_types: "PDF · PNG · JPG · WEBP · TIFF · XLSX · CSV · her biri en fazla 25 MB",
  drop_sheet_note:
    "Elinizde tablo mu var? .xlsx ya da .csv dosyasını doğrudan bırakın — modele uğramadan eşleştiriciye gider.",
  sheet_badge: "tablo",
  sheet_read_one: "Tabloyu oku",
  sheet_read_many: "{n} tabloyu oku",
  sheet_reading: "Okunuyor…",
  queue_count_one: "{n} belge",
  queue_count_many: "{n} belge",
  queue_clear: "Tümünü temizle",
  queue_remove: "{name} belgesini kaldır",
  totals_ok: "toplam ✓",
  totals_bad: "toplam ✕",

  quality: "Kalite",
  tier_fast_label: "Hızlı",
  tier_fast_blurb: "Hızlı ve ucuz — temiz dijital belgeler için ideal",
  tier_balanced_label: "Dengeli",
  tier_balanced_blurb: "Fiyat/doğruluk dengesi — en isabetli seçim",
  tier_best_label: "En iyi",
  tier_best_blurb: "En yüksek doğruluk — bozuk taramalar ve yoğun tablolar",
  tier_price: "≈ {price} $ / 1M girdi jetonu",

  advanced: "Gelişmiş seçenekler",
  custom_model: "Özel model kimliği",
  pdf_engine: "PDF motoru",
  engine_auto: "Otomatik — ücretsiz metin katmanı, taramalarda OCR (önerilir)",
  engine_mistral: "Mistral OCR — taramalar ve fotoğraflar için en iyisi (1.000 sayfa 2 $)",
  engine_native: "Modelin kendisi — PDF’i doğrudan model okur",
  engine_pdf_text: "PDF metni — ücretsiz, yalnızca dijital (metinli) PDF’ler",
  engine_used_text: "metin katmanı · ücretsiz",
  engine_used_ocr: "Mistral OCR",
  engine_used_native: "model",

  extract_one: "Tabloları çıkar",
  extract_many: "{n} belgeyi çıkar",
  extracting: "Çıkarılıyor…",
  status_done: "{n} tamamlandı · {rows} satır",

  combined: "Birleşik",
  layout: "Kendi düzeniniz",
  use_in_combined: "Birleşikte kullan",
  in_combined: "Birleşikte",
  columns: "Sütunlar",
  columns_title: "Sütun düzeni",
  columns_hint:
    "Sütunları yeniden adlandırın, sıralayın ya da kapatın — düzen hatırlanır, böylece stok programınızın istediği sıralamayı yalnızca bir kez ayarlarsınız.",
  columns_reset: "Algılanana sıfırla",
  columns_include: "{name} sütununu dahil et",
  columns_rename: "{name} sütununu yeniden adlandır",
  columns_move_up: "{name} sütununu yukarı taşı",
  columns_move_down: "{name} sütununu aşağı taşı",
  rows_one: "{n} satır.",
  rows_many: "{n} satır.",
  rows_truncated: "İlk {n} / {total} satır gösteriliyor — indirilen dosyada hepsi var.",
  csv_note: " CSV yalnızca bu sayfayı kaydeder; Excel hepsini kaydeder.",
  copy_note: "Kopyala tüm satırları panoya alır, açık bir tabloya yapıştırmaya hazır.",
  copy: "Kopyala",
  copied: "Kopyalandı",
  preparing: "Hazırlanıyor…",

  matcher_title: "Barkod → ürün adı",
  matcher_subtitle:
    "Tedarikçinin yazmadığı ürün adlarını, barkod sütununu bir katalogla eşleştirerek doldurun.",
  matcher_enable: "Açık",
  matcher_no_column: "Bu sayfada barkod sütunu bulunamadı.",
  matcher_off: "Kapalı — sayfalarda modelin okuduğu hâli görünüyor.",
  matcher_matched: "{rows} barkodlu satırın {matched} tanesi adlandırıldı",
  matcher_priced: "{n} tanesine etiket fiyatı yazıldı",
  matcher_priced_none: "etiket fiyatı yayımlayan kaynak yok",
  matcher_price_hint:
    "Bu ürünlerin hiçbiri fiyatıyla yayımlanmamış. Kendi fiyat listenizi aşağıya yapıştırın — her satırda barkod, ad ve etiket fiyatı — bundan sonraki her tabloya fiyatlar da yazılsın.",
  matcher_repaired_one: "{n} yanlış okunan barkod düzeltildi",
  matcher_repaired_many: "{n} yanlış okunan barkod düzeltildi",
  matcher_unmatched: "{n} eşleşmedi",
  matcher_unmatched_hint:
    "Bu kodları henüz hiçbir kaynak bilmiyor. Çevrimiçi arayın ya da aşağıdaki kendi listenize ekleyin.",
  matcher_catalog_size_one: "katalogda {n} ürün",
  matcher_catalog_size_many: "katalogda {n} ürün",
  matcher_sources: "Kaynaklar",
  matcher_all: "Tüm kaynakları kullan",
  matcher_own: "Kendi listeniz",
  matcher_own_blurb:
    "Barkod, ad ve etiket fiyatını yapıştırın ya da içe aktarın. Diğer kaynakların önüne geçer — ilaçlara fiyat yazabilen tek kaynak da budur.",
  matcher_own_toggle: "Kendi listenizi kullan",
  matcher_own_count_one: "{n} ürün",
  matcher_own_count_many: "{n} ürün",
  matcher_own_priced: "{n} tanesi fiyatlı",
  matcher_own_skipped_one: "{n} satır atlandı",
  matcher_own_skipped_many: "{n} satır atlandı",
  matcher_shop_blurb: "{site} adresinde yayımlanan tüm ürünler, doğrudan mağazadan okunur.",
  matcher_shop_toggle: "{name} kataloğunu kullan",
  matcher_shop_count: "{n} yüklendi",
  matcher_add_shop: "Başka mağaza ekle",
  matcher_add_shop_hint:
    "Ürünlerini barkodlarıyla yayımlayan her mağaza çalışır — sunucu mağazanın kendi site haritasını ve ürün verisini okur. Yalnızca herkese açık https adresleri.",
  matcher_add: "Ekle",
  matcher_registry_blurb:
    "TİTCK’nın her hafta yayımladığı ilaç listesinden, Türkiye’deki tüm ruhsatlı ilaçlar.",
  matcher_registry_no_price:
    "Bu listede fiyat yer almaz — ilacın etiket fiyatı için kendi listenizi kullanın.",
  matcher_registry_toggle: "TİTCK ilaç kaydını kullan",
  matcher_registry_count: "{n} kayıt",
  matcher_sector_pharmacy: "Eczane",
  matcher_sector_beauty: "Kozmetik ve kişisel bakım",
  matcher_extras: "Ayrıca ekle",
  matcher_extra_brand: "Üretici",
  matcher_extra_price: "Etiket fiyatı",
  matcher_extra_note: "ATC / kategori",
  matcher_loading: "Yükleniyor…",
  matcher_refresh: "Yenile",
  matcher_open: "Açık veritabanları",
  matcher_open_blurb: "Open Food Facts ve Open Beauty Facts — ücretsiz, dünya geneli, anahtar gerekmez.",
  matcher_open_toggle: "Kodları açık veritabanlarında otomatik ara",
  matcher_open_auto: "Diğer iki kaynağın adlandıramadığı kodlar burada otomatik aranır.",
  matcher_open_count_one: "{n} ad bulundu",
  matcher_open_count_many: "{n} ad bulundu",
  matcher_look_up_one: "{n} kodu ara",
  matcher_look_up_many: "{n} kodu ara",
  matcher_looking_up: "Aranıyor…",
  matcher_list_label: "Barkod listeniz",
  matcher_list_hint:
    "Her satırda bir ürün — barkod, ad ve varsa etiket fiyatı. Aralarında noktalı virgül ya da sekme; başlık satırı varsa o da okunur.",
  matcher_import: "CSV içe aktar",
  matcher_clear: "Temizle",
  matcher_mode: "Ad nereye yazılsın",
  matcher_mode_new: "Yeni sütun ekle",
  matcher_mode_fill: "Ürün sütunundaki boşlukları doldur",
  matcher_column_label: "Sütun başlığı",
  matcher_default_label: "Ürün adı",

  recon_ok_title: "Toplamlar tutuyor.",
  recon_ok_body: "“{column}” toplamı {sum} ediyor ve belgedeki “{label}” ile eşleşiyor.",
  recon_bad_title: "Toplamlar tutmuyor.",
  recon_bad_body:
    "“{column}” toplamı {sum} ediyor ama belgede “{label}” için {stated} yazıyor — {delta} fark var. Kullanmadan önce kontrol etmekte fayda var.",

  col_source: "Kaynak",
  col_barcode: "Barkod",
  col_code: "Kod",
  col_item: "Ürün",
  col_quantity: "Miktar",
  col_unit: "Birim",
  col_unit_price: "Birim fiyat",
  col_discount: "İskonto",
  col_vat: "KDV",
  col_amount: "Tutar",
  col_date: "Tarih",
}

export const DICTS: Record<Lang, Record<StringKey, string>> = { en, tr }

export function translate(
  lang: Lang,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  const template = DICTS[lang]?.[key] ?? en[key] ?? String(key)
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  )
}
