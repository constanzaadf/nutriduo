import type { Metadata } from "next";
import { requireContext } from "@/lib/session";
import { loadEditorIngredients } from "@/lib/data/editor";
import { LinkButton, PageHeader, Panel, Empty } from "@/components/ui";
import { RecipeEditor } from "../recipe-editor";

export const metadata: Metadata = { title: "Nueva receta" };

export default async function NewRecipePage() {
  const ctx = await requireContext();
  const ingredients = await loadEditorIngredients(ctx.supabase);
  return (
    <>
      <PageHeader title="Nueva receta" lead="Ingredientes por porción. Después se ajusta a cada persona." />
      {ingredients.length === 0 ? (
        <Empty title="Primero carga ingredientes" action={<LinkButton href="/ingredientes">Ir a ingredientes</LinkButton>}>
          Cada ingrediente necesita sus valores por 100 g para que la receta se pueda calcular.
        </Empty>
      ) : (
        <Panel>
          <RecipeEditor
            isNewVersion={false}
            ingredients={ingredients}
            initial={{
              recipeId: null,
              parentVersionId: null,
              name: "",
              category: "almuerzos",
              tags: [],
              prep_minutes: null,
              servings_nominal: 2,
              is_homogeneous: false,
              expected_cooked_yield_g: null,
              instructions: "",
              lines: [{ ingredient_id: "", grams: 100, state: "raw", role: "adjustable", min_g: null, max_g: null, ratio_group: null, integer_unit_g: null }],
            }}
          />
        </Panel>
      )}
    </>
  );
}
