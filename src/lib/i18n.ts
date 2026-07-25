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
    "Drop a stack of PDFs or photos — the best OCR models pull out every table, check the totals add up, and stack them into one sheet you can download as Excel, CSV, or JSON.",
  lock: "Lock",

  // key warning
  no_key_title: "No OpenRouter key set.",
  no_key_body: "Extraction needs {code} on the server.",

  // dropzone + queue
  drop_first: "Drop PDFs or images, or click to browse",
  drop_more: "Add more documents",
  drop_types: "PDF · PNG · JPG · WEBP · TIFF · max 25 MB each",
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
  use_in_combined: "Use in Combined",
  in_combined: "In Combined",
  columns: "Columns",
  columns_title: "Combined columns",
  columns_hint:
    "Rename or switch off columns — the choice is remembered for next time, so a supplier’s layout only has to be set up once.",
  columns_reset: "Reset to detected",
  columns_include: "Include {name}",
  columns_rename: "Rename {name}",
  rows_one: "{n} row.",
  rows_many: "{n} rows.",
  rows_truncated: "Showing first {n} of {total} rows — the download has them all.",
  csv_note: " CSV saves this sheet only; Excel saves all of them.",
  preparing: "Preparing…",

  // barcode matcher
  matcher_title: "Barcode → name",
  matcher_subtitle:
    "Fill in the product names your supplier left out, by matching the barcode column against a catalog.",
  matcher_enable: "On",
  matcher_no_column: "No barcode column found in this sheet.",
  matcher_off: "Switched off — the sheets show exactly what the model read.",
  matcher_matched: "{matched} of {rows} barcode rows named",
  matcher_unmatched: "{n} unmatched",
  matcher_unmatched_hint:
    "Nothing knows these codes yet. Look them up online, or paste them into your own list below.",
  matcher_catalog_size: "{n} products in the catalog",
  matcher_sources: "Sources",
  matcher_own: "Your list",
  matcher_own_blurb: "Paste or import barcode + name pairs. Beats every other source.",
  matcher_own_count: "{n} pairs",
  matcher_own_skipped: "{n} lines skipped",
  matcher_shop_name: "Nature & Nurture",
  matcher_shop_blurb: "Every product on the Nature & Nurture shop, read straight from the site.",
  matcher_shop_toggle: "Use the Nature & Nurture catalog",
  matcher_shop_count: "{n} products loaded",
  matcher_loading: "Loading…",
  matcher_refresh: "Refresh",
  matcher_open: "Open databases",
  matcher_open_blurb: "Open Food Facts and Open Beauty Facts — free, worldwide, no key.",
  matcher_open_count: "{n} names found",
  matcher_look_up: "Look up {n} codes",
  matcher_looking_up: "Looking up…",
  matcher_list_label: "Your barcode list",
  matcher_list_hint: "One pair per line — comma, semicolon or tab between them.",
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
    "Bir yığın PDF veya fotoğraf bırakın — en iyi OCR modelleri her tabloyu çıkarır, toplamların tuttuğunu denetler ve hepsini Excel, CSV ya da JSON olarak indirebileceğiniz tek bir sayfada birleştirir.",
  lock: "Kilitle",

  no_key_title: "OpenRouter anahtarı tanımlı değil.",
  no_key_body: "Çıkarma işlemi için sunucuda {code} gerekir.",

  drop_first: "PDF veya görselleri bırakın ya da seçmek için tıklayın",
  drop_more: "Başka belge ekleyin",
  drop_types: "PDF · PNG · JPG · WEBP · TIFF · her biri en fazla 25 MB",
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
  use_in_combined: "Birleşikte kullan",
  in_combined: "Birleşikte",
  columns: "Sütunlar",
  columns_title: "Birleşik sütunlar",
  columns_hint:
    "Sütunları yeniden adlandırın ya da kapatın — seçiminiz hatırlanır, böylece bir tedarikçinin düzenini yalnızca bir kez ayarlarsınız.",
  columns_reset: "Algılanana sıfırla",
  columns_include: "{name} sütununu dahil et",
  columns_rename: "{name} sütununu yeniden adlandır",
  rows_one: "{n} satır.",
  rows_many: "{n} satır.",
  rows_truncated: "İlk {n} / {total} satır gösteriliyor — indirilen dosyada hepsi var.",
  csv_note: " CSV yalnızca bu sayfayı kaydeder; Excel hepsini kaydeder.",
  preparing: "Hazırlanıyor…",

  matcher_title: "Barkod → ürün adı",
  matcher_subtitle:
    "Tedarikçinin yazmadığı ürün adlarını, barkod sütununu bir katalogla eşleştirerek doldurun.",
  matcher_enable: "Açık",
  matcher_no_column: "Bu sayfada barkod sütunu bulunamadı.",
  matcher_off: "Kapalı — sayfalarda modelin okuduğu hâli görünüyor.",
  matcher_matched: "{rows} barkodlu satırın {matched} tanesi adlandırıldı",
  matcher_unmatched: "{n} eşleşmedi",
  matcher_unmatched_hint:
    "Bu kodları henüz hiçbir kaynak bilmiyor. Çevrimiçi arayın ya da aşağıdaki kendi listenize ekleyin.",
  matcher_catalog_size: "katalogda {n} ürün",
  matcher_sources: "Kaynaklar",
  matcher_own: "Kendi listeniz",
  matcher_own_blurb: "Barkod + ad çiftlerini yapıştırın ya da içe aktarın. Diğer kaynakların önüne geçer.",
  matcher_own_count: "{n} çift",
  matcher_own_skipped: "{n} satır atlandı",
  matcher_shop_name: "Nature & Nurture",
  matcher_shop_blurb: "Nature & Nurture mağazasındaki tüm ürünler, doğrudan siteden okunur.",
  matcher_shop_toggle: "Nature & Nurture kataloğunu kullan",
  matcher_shop_count: "{n} ürün yüklendi",
  matcher_loading: "Yükleniyor…",
  matcher_refresh: "Yenile",
  matcher_open: "Açık veritabanları",
  matcher_open_blurb: "Open Food Facts ve Open Beauty Facts — ücretsiz, dünya geneli, anahtar gerekmez.",
  matcher_open_count: "{n} ad bulundu",
  matcher_look_up: "{n} kodu ara",
  matcher_looking_up: "Aranıyor…",
  matcher_list_label: "Barkod listeniz",
  matcher_list_hint: "Her satırda bir çift — aralarında virgül, noktalı virgül ya da sekme.",
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
