-- ════════════════════════════════════════════════════════════════════════
-- NutriDuo · 005 · Almacenamiento (fotos de recetas, pautas importadas)
-- Rutas: <household_id>/recipes/<archivo> · <household_id>/plans/<profile_id>/<archivo>
-- Solo aplica si existe el esquema storage (proyecto Supabase real).
-- ════════════════════════════════════════════════════════════════════════
do $outer$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'Sin esquema storage: se omite (entorno de pruebas)';
    return;
  end if;

  insert into storage.buckets (id, name, public)
    values ('household-files', 'household-files', false)
    on conflict (id) do nothing;

  execute $p$
    create policy household_files_read on storage.objects for select to authenticated
    using (bucket_id = 'household-files'
           and public.is_member(((storage.foldername(name))[1])::uuid)
           and ((storage.foldername(name))[2] <> 'plans'
                or public.can_view_profile(((storage.foldername(name))[3])::uuid, 'full')))
  $p$;
  execute $p$
    create policy household_files_write on storage.objects for insert to authenticated
    with check (bucket_id = 'household-files'
                and public.is_member(((storage.foldername(name))[1])::uuid)
                and ((storage.foldername(name))[2] <> 'plans'
                     or public.can_edit_profile(((storage.foldername(name))[3])::uuid)))
  $p$;
  execute $p$
    create policy household_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'household-files'
           and public.is_member(((storage.foldername(name))[1])::uuid)
           and ((storage.foldername(name))[2] <> 'plans'
                or public.can_edit_profile(((storage.foldername(name))[3])::uuid)))
  $p$;
end
$outer$;
