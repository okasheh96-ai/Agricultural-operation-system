-- IN-BROWSER DEMO ONLY (scripts/build-browser-demo.mjs). Never apply to a Supabase project or any server database.
-- Applied after supabase/tests/_shim.sql. The in-browser demo has no Supabase Auth service, so the demo people's
-- password check runs here, inside the demo database that lives in the viewer's own browser. It is a demo sign-in, not
-- a security boundary: the whole database is on the viewer's device.

alter table auth.users add column if not exists password_sha256 text;

-- Returns the user for a correct email + password, nothing otherwise (same answer for unknown email and wrong password).
create or replace function auth.browser_demo_sign_in(p_email text, p_password text)
returns table (id uuid, email text, created_at timestamptz)
language sql stable security definer set search_path = auth, pg_temp
as $$
  select u.id, u.email, u.created_at
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
     and u.password_sha256 = encode(sha256(convert_to(p_password, 'UTF8')), 'hex')
$$;
revoke all on function auth.browser_demo_sign_in(text, text) from public, anon, authenticated;

create or replace function auth.browser_demo_user(p_id uuid)
returns table (id uuid, email text, created_at timestamptz)
language sql stable security definer set search_path = auth, pg_temp
as $$ select u.id, u.email, u.created_at from auth.users u where u.id = p_id $$;
revoke all on function auth.browser_demo_user(uuid) from public, anon, authenticated;
