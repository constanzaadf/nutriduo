# NutriDuo

Planificación alimentaria para dos personas que comparten cocina pero tienen objetivos distintos. Cada comida del calendario es **un evento con una porción por persona**: se cocina una vez, cada uno recibe lo que le corresponde según su meta, y todo termina en una sola lista de compras.

El documento de diseño (navegación, wireframes, modelo de datos, flujos y motores) está en Claude Docs: *NutriDuo — Diseño técnico y funcional (v0.1)*.

## Qué hay en este repositorio

```
nutriduo/
├── packages/                     Lógica crítica: TypeScript puro, sin dependencias, con pruebas
│   ├── domain/                   Nutrientes, unidades, estados crudo/cocido, procedencia de cada cifra
│   ├── nutrition-engine/         Metas: Mifflin-St Jeor / Katch-McArdle, TDEE sin doble conteo, pisos, pauta por intercambios
│   ├── portion-engine/           Porciones: solver MILP propio (simplex + branch-and-bound), comidas compartidas, evaluación de recetas
│   ├── shopping-engine/          Compras: consolidación, neteo contra inventario, formatos comerciales, diff que conserva lo marcado
│   ├── menu-engine/              Menú semanal: ollas del domingo (refrigerado/congelado), comidas del día, metas de ambos
│   └── catalog/                  Catálogo base: 94 ingredientes con datos USDA SR28 y 37 recetas validadas contra los motores
├── supabase/
│   ├── migrations/               31 tablas, triggers de integridad, RLS por hogar y visibilidad, funciones transaccionales
│   ├── seed.sql                  Tabla de intercambios por defecto (rotulada como estimada)
│   ├── setup_completo.sql        Todo lo anterior en un archivo, para un proyecto nuevo (generado)
│   ├── catalogo_recetario.sql    Actualización para proyectos que ya tenían 001–005 (generado; se puede correr dos veces)
│   └── tests/                    Pruebas SQL de integridad y privacidad (corren contra cualquier Postgres 16)
└── apps/web/                     Next.js 15 (App Router), React 19, Tailwind 4, Supabase Auth
```

## Puesta en marcha

1. **Supabase.** Crea un proyecto. En *SQL Editor* pega y ejecuta `supabase/setup_completo.sql` (o usa `supabase link` + `supabase db push` y luego `supabase/seed.sql`). Si ya habías instalado una versión anterior, ejecuta solo `supabase/catalogo_recetario.sql`. En *Authentication → URL Configuration* agrega tu URL y `https://TU-URL/auth/callback` como redirect.
2. **Variables.** Copia `apps/web/.env.example` a `apps/web/.env.local` y completa con *Project Settings → API*. La `SUPABASE_SERVICE_ROLE_KEY` es solo de servidor.
3. **Instalar y correr.**
   ```bash
   corepack enable
   pnpm install
   pnpm dev            # http://localhost:3000
   ```
4. **Desplegar.** En Vercel, importa el repo con *Root Directory* `apps/web` y las mismas variables de entorno.

Primer uso: cada persona crea su cuenta con correo y contraseña (también hay enlace por correo como alternativa). Una persona crea el hogar y comparte el código de 8 caracteres; la otra se une. Cada uno completa su perfil y guarda una meta (calculada, indicada por un profesional o como pauta por porciones). El hogar parte con el recetario base cargado (37 recetas) y los ingredientes del catálogo; después: calendario. Recetas e ingredientes propios se agregan igual que siempre.

## Pruebas

```bash
pnpm test                          # 327 pruebas: motores, catálogo y menú semanal
pnpm typecheck                     # tipos de los motores y del catálogo
pnpm catalog:generate              # regenera el SQL del catálogo (el CI exige que esté al día)
DATABASE_URL=postgres://... ./supabase/tests/run.sh   # migraciones + 87 verificaciones SQL en una base desechable
```

| Criterio del prompt | Dónde se prueba |
| --- | --- |
| 1. Metas de un perfil no afectan al otro | `nutrition-engine/test/compute.test.ts` (pureza), `portion-engine/test/portions.test.ts` |
| 2. Receta compartida → porciones individuales correctas | `portion-engine/test/portions.test.ts`, `shopping-engine/test/pipeline.test.ts` |
| 3. Comida individual afecta solo a su perfil | SQL: un perfil, una comida por tiempo; motor: un problema por participante |
| 4. Ingredientes compartidos se compran una vez | `shopping-engine/test/shopping.test.ts` |
| 5. kcal y macros = suma de ingredientes | `portions.test.ts` (después del redondeo de cocina) |
| 6. Cambios del calendario recalculan compras | `shopping.test.ts`, `pipeline.test.ts` (diff) |
| 7. Cambios de porción recalculan nutrientes | `portions.test.ts` |
| 8. Recetas originales se conservan | SQL: versiones selladas e inmutables |
| 9. Sobrantes no se cuentan dos veces | `shopping.test.ts` (lo servido de un lote no genera compra), SQL: tope de lotes |
| 10. Persistencia | Supabase |
| 11. Restricciones alimentarias | motor (bloqueo antes del solver) + SQL (trigger de alergias) |
| 12. Móvil | diseño móvil primero, navegación inferior |

## Decisiones que conviene conocer

- **La IA no calcula.** Metas, porciones y compras salen de código determinista con traza (`calculation_runs`). Misma entrada, mismo resultado.
- **Solver propio en vez de HiGHS.** Los problemas tienen decenas de variables; un simplex con branch-and-bound en TypeScript evita cargar WebAssembly en serverless y es idéntico en todos los entornos. Se valida contra búsqueda exhaustiva en 200 problemas aleatorios.
- **Crudo y cocido nunca se mezclan.** Las preparaciones homogéneas (guisos, salsas) se reparten en gramos de preparación terminada; pesar la olla vuelve exactas las porciones (sin peso, quedan rotuladas `≈`).
- **Privacidad por fila.** Compartir cocina no implica compartir datos de salud. Visibilidad por persona: *nada*, *resumen* (gramos de la porción compartida) o *todo*. Las alergias sí se comparten con el hogar. El cálculo de una comida compartida lee la meta de la otra persona en el servidor (service role) solo después de verificar que ambos pertenecen al hogar, y al navegador vuelve lo que la visibilidad permite.
- **Sin compensaciones.** Un desvío registrado no cambia las comidas siguientes.
- **Menú semanal con cocina del domingo.** *Calendario → Proponer semana* arma la semana siguiente: 2 a 4 ollas homogéneas (guisos, legumbres, salsas) cocinadas el domingo cubren almuerzos (y, si se elige, cenas) de lunes a viernes, rotando para no repetir plato en comidas seguidas y sin repetir proteína entre ollas. Lo que se come más de 3 días después de cocinar se congela ese domingo (la comida cocida dura 3 a 4 días refrigerada). El fin de semana y los desayunos se cocinan en el día, con tope de tiempo (10 min desayunos y 25 min el resto en semana; 90 min el fin de semana). Cada olla se dimensiona sumando las porciones calculadas para cada persona más un 8 % de margen. Si una alergia afecta solo a un acompañamiento, esa persona lo omite en vez de descartar la receta. Es determinista: *Otra propuesta* cambia la semilla. Aplicar crea lotes y comidas en una transacción y aprueba las porciones, así todo entra a la lista de compras (que toma las ollas del domingo anterior).

## Estado

**Verificado:** los motores, el catálogo y el menú semanal (327 pruebas y tipos estrictos), la base de datos (migraciones aplicadas sobre Postgres 16 con un dueño sin privilegios especiales, como en Supabase, y 87 verificaciones de integridad, RLS, catálogo y menú) y el build de la app en CI. Las dependencias quedan fijas en `pnpm-lock.yaml`: CI y Vercel instalan con `--frozen-lockfile`. Si cambia un `package.json`, el workflow *Lockfile* regenera y commitea el lockfile.

**Pendiente (fase 2 del diseño):** importar recetas y pautas desde URL, imagen o PDF; "hacer fit" con IA y modo conjunto del motor (optimizar la olla para ambos); asistente conversacional; arrastrar y soltar en el calendario (hoy se mueve desde el detalle de la comida); alertas de vencimiento.

## Fuentes nutricionales

Cada valor guarda su fuente (`label` = etiqueta del envase, `fdc` = USDA FoodData Central, `manual` = estimado) y su nivel de confianza. La tabla de intercambios por defecto es una referencia de uso habitual en Chile, marcada como estimada: si tienes una pauta, sus valores mandan.

**Catálogo base.** Los valores por 100 g vienen de USDA National Nutrient Database for Standard Reference, Release 28 (SR28, dominio público; mismos datos que *SR Legacy* en FoodData Central). Se extrajeron de `ABBREV.txt` con `packages/catalog/scripts/extract-sr28.ts`; el extracto guarda la huella sha256 del archivo y cada fila cita su código NDB y la descripción original en inglés. Además:

- **Rendimiento crudo → cocido**, derivado de los mismos datos: balance de materia seca para cereales, legumbres y tubérculos; conservación de proteína para carnes.
- **Gramos por porción de intercambio**, derivados del nutriente que define cada grupo (carbohidratos en cereales, frutas, verduras, legumbres y azúcares; proteína en carnes; energía en lácteos; grasa en aceites). Son estimaciones: si la pauta de tu nutricionista dice otra cosa, ajústalo en *Ingredientes* y vale solo para tu hogar.
- **Pesos por unidad** (huevo, pan, tortilla, plátano) tomados de las medidas caseras de SR28.
- Productos de marca (proteína en polvo, quesillo, panes específicos) conviene cargarlos con su etiqueta: el valor genérico es una aproximación.

Las 37 recetas son preparaciones caseras de uso común, sin pescados, mariscos, cerdo, pavo ni quinoa. Cada una se prueba contra los motores: datos completos, porción factible para un perfil de pérdida de grasa y uno de ganancia muscular, y funcionamiento en modo pauta por porciones.

La app apoya la planificación; no reemplaza la atención nutricional. Con embarazo, lactancia o una condición médica declarada, no aplica déficit ni superávit automático.
