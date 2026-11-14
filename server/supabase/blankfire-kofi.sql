-- Blankfire: donaciones de Ko-fi para la meta «activar la IA».
-- Solo se guarda lo mínimo: un hash de la transacción, importe, moneda, tipo y fecha. Ni nombres ni emails.
create table if not exists blankfire.kofi (
  tx text primary key,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null,
  kind text not null,
  at timestamptz not null default now()
);
alter table blankfire.kofi enable row level security;   -- sin políticas: solo el servidor (service_role)
revoke all on blankfire.kofi from public, anon, authenticated;
grant all on blankfire.kofi to service_role;

-- Apunta una donación (si Ko-fi reintenta el mismo aviso, no se cuenta dos veces).
create or replace function public.blankfire_kofi_add(p_tx text, p_amount numeric, p_currency text, p_kind text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into blankfire.kofi (tx, amount, currency, kind) values (p_tx, p_amount, upper(p_currency), p_kind)
  on conflict (tx) do nothing;
  return found;
end $$;

-- Total por moneda y número de aportaciones.
create or replace function public.blankfire_kofi_total()
returns json language sql security definer set search_path = '' as $$
  select json_build_object(
    'by_currency', coalesce((select json_object_agg(currency, s) from (select currency, sum(amount) s from blankfire.kofi group by currency) t), '{}'::json),
    'count', (select count(*) from blankfire.kofi)
  );
$$;

revoke all on function public.blankfire_kofi_add(text, numeric, text, text) from public, anon, authenticated;
revoke all on function public.blankfire_kofi_total() from public, anon, authenticated;
grant execute on function public.blankfire_kofi_add(text, numeric, text, text) to service_role;
grant execute on function public.blankfire_kofi_total() to service_role;
