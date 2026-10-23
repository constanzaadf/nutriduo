/**
 * Extrae del archivo oficial USDA SR28 "ABBREV.txt" solo las filas que usa el
 * catálogo y las guarda en data/sr28-extract.json, con la huella del archivo.
 *
 *   pnpm --filter @nutriduo/catalog extract /ruta/a/ABBREV.txt
 *
 * Fuente del archivo: USDA National Nutrient Database for Standard Reference,
 * Release 28 (dominio público). Formato descrito en sr28_doc.pdf, sección
 * "Abbreviated file" (53 campos separados por ^, texto entre ~).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_INGREDIENTS } from "../src/ingredients";

const src = process.argv[2];
if (!src) {
  console.error("Uso: extract-sr28.ts <ruta a ABBREV.txt>");
  process.exit(1);
}
const raw = readFileSync(src);
const sha256 = createHash("sha256").update(raw).digest("hex");
const text = raw.toString("latin1");

const wanted = new Set<string>();
for (const i of CATALOG_INGREDIENTS) {
  wanted.add(i.ndb);
  if (i.cookedNdb) wanted.add(i.cookedNdb);
}

const num = (s: string) => (s === "" ? null : Number(s));
const rows: Record<string, unknown> = {};
for (const line of text.split(/\r?\n/)) {
  if (!line) continue;
  const f = line.split("^").map((x) => x.replace(/^~|~$/g, ""));
  if (f.length !== 53) throw new Error(`Línea con ${f.length} campos (se esperaban 53): ${line.slice(0, 40)}`);
  const ndb = f[0]!;
  if (!wanted.has(ndb)) continue;
  rows[ndb] = {
    ndb,
    description: f[1],
    water_g: num(f[2]!),
    kcal: num(f[3]!),
    protein_g: num(f[4]!),
    fat_g: num(f[5]!),
    carbs_g: num(f[7]!),
    fiber_g: num(f[8]!),
    sodium_mg: num(f[15]!),
    household_weights: [
      { grams: num(f[48]!), measure: f[49] },
      { grams: num(f[50]!), measure: f[51] },
    ].filter((w) => w.grams !== null),
  };
}
const missing = [...wanted].filter((n) => !rows[n]);
if (missing.length) throw new Error(`NDB no encontrados en SR28: ${missing.join(", ")}`);

const out = {
  source: "USDA National Nutrient Database for Standard Reference, Release 28 (SR28), archivo abreviado ABBREV.txt",
  source_note: "Dominio público. SR28 es la misma base publicada después como 'SR Legacy' en FoodData Central.",
  file_sha256: sha256,
  extracted_rows: Object.keys(rows).length,
  rows: Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b))),
};
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "sr28-extract.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`Escribí ${out.extracted_rows} filas en ${target} (sha256 ${sha256.slice(0, 12)}…)`);
