"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { Button } from "./ui";

/** Botón de envío que se desactiva mientras la acción corre. */
export function Submit({ children, pendingLabel, ...rest }: ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" {...rest} disabled={pending || rest.disabled} aria-busy={pending}>
      {pending ? pendingLabel ?? "Guardando…" : children}
    </Button>
  );
}
