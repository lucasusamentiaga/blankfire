-- Blankfire (extensión de paper trading): contador de análisis con IA.
-- Va en su propio esquema «blankfire» y no toca nada más del proyecto.
create schema if not exists blankfire;
revoke all on schema blankfire from public, anon, authenticated;

create table if not exists blankfire.ai_usage (
  subject text not null,        -- '*' (total del día) · 'lic:<hash>' · 'beta:<hash>'
  day date not null default (now() at time zone 'utc')::date,
  n integer not null default 0,
  primary key (subject, day)
);
alter table blankfire.ai_usage enable row level security;   -- sin políticas: solo el servidor (service_role)
revoke all on blankfire.ai_usage from public, anon, authenticated;

-- Suma 1 si no se ha llegado al tope; devuelve el nuevo número o -1 si ya estaba en el tope.
create or replace function public.blankfire_ai_take(p_subject text, p_cap integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  insert into blankfire.ai_usage as u (subject, day, n) values (p_subject, (now() at time zone 'utc')::date, 1)
  on conflict (subject, day) do update set n = u.n + 1 where u.n < p_cap
  returning u.n into v;
  return coalesce(v, -1);
end $$;

-- Devuelve el uso si el análisis falló.
create or replace function public.blankfire_ai_refund(p_subject text)
returns void language sql security definer set search_path = '' as $$
  update blankfire.ai_usage set n = greatest(0, n - 1) where subject = p_subject and day = (now() at time zone 'utc')::date;
$$;

-- Limpieza: fuera los contadores de hace más de 40 días.
create or replace function public.blankfire_ai_gc()
returns void language sql security definer set search_path = '' as $$
  delete from blankfire.ai_usage where day < (now() at time zone 'utc')::date - 40;
$$;

revoke all on function public.blankfire_ai_take(text, integer) from public, anon, authenticated;
revoke all on function public.blankfire_ai_refund(text) from public, anon, authenticated;
revoke all on function public.blankfire_ai_gc() from public, anon, authenticated;
grant execute on function public.blankfire_ai_take(text, integer) to service_role;
grant execute on function public.blankfire_ai_refund(text) to service_role;
grant execute on function public.blankfire_ai_gc() to service_role;
grant usage on schema blankfire to service_role;
grant all on blankfire.ai_usage to service_role;
