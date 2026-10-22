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
│   └── shopping-engine/          Compras: consolidación, neteo contra inventario, formatos comerciales, diff que conserva lo marcado
├── supabase/
│   ├── migrations/               31 tablas, triggers de integridad, RLS por hogar y visibilidad, funciones transaccionales
│   ├── seed.sql                  Tabla de intercambios por defecto (rotulada como estimada; sin recetas inventadas)
│   └── tests/                    Pruebas SQL de integridad y privacidad (corren contra cualquier Postgres 16)
└── apps/web/                     Next.js 15 (App Router), React 19, Tailwind 4, Supabase Auth
```

## Puesta en marcha

1. **Supabase.** Crea un proyecto. En *SQL Editor* ejecuta, en orden, los archivos de `supabase/migrations/` y luego `supabase/seed.sql` (o usa `supabase link` + `supabase db push`). En *Authentication → URL Configuration* agrega tu URL y `https://TU-URL/auth/callback` como redirect.
2. **Variables.** Copia `apps/web/.env.example` a `apps/web/.env.local` y completa con *Project Settings → API*. La `SUPABASE_SERVICE_ROLE_KEY` es solo de servidor.
3. **Instalar y correr.**
   ```bash
   corepack enable
   pnpm install
   pnpm dev            # http://localhost:3000
   ```
4. **Desplegar.** En Vercel, importa el repo con *Root Directory* `apps/web` y las mismas variables de entorno.

Primer uso: una persona crea el hogar y comparte el código de 8 caracteres; la otra se une. Cada uno completa su perfil y guarda una meta (calculada, indicada por un profesional o como pauta por porciones). Después: ingredientes → recetas → calendario.

## Pruebas

```bash
pnpm test                          # 109 pruebas de los motores (node:test)
pnpm typecheck                     # tipos de los motores
DATABASE_URL=postgres://... ./supabase/tests/run.sh   # migraciones + 59 verificaciones SQL en una base desechable
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

## Estado

**Verificado en el entorno de desarrollo:** los motores (109 pruebas y tipos estrictos) y la base de datos (migraciones aplicadas sobre Postgres 16 y 59 verificaciones de integridad y RLS).

**Escrito pero no compilado todavía:** la app web. El entorno donde se construyó no tenía acceso al registro de npm, así que se verificó con tipos sustitutos para Next/Supabase/React. El primer `pnpm install && pnpm build` puede mostrar ajustes menores de tipos; el CI (`.github/workflows/ci.yml`) los detecta.

**Pendiente (fase 2 del diseño):** importar recetas y pautas desde URL, imagen o PDF; "hacer fit" con IA y modo conjunto del motor (optimizar la olla para ambos); generador automático de menú semanal; asistente conversacional; arrastrar y soltar en el calendario (hoy se mueve desde el detalle de la comida); alertas de vencimiento.

## Fuentes nutricionales

Cada valor guarda su fuente (`label` = etiqueta del envase, `fdc` = USDA FoodData Central, `manual` = estimado) y su nivel de confianza. La tabla de intercambios por defecto es una referencia de uso habitual en Chile, marcada como estimada: si tienes una pauta, sus valores mandan.

La app apoya la planificación; no reemplaza la atención nutricional. Con embarazo, lactancia o una condición médica declarada, no aplica déficit ni superávit automático.
