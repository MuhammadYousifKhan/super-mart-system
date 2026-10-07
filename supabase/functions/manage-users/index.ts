// Supabase Edge Function: lets an admin manage staff accounts from inside the POS app.
//
// Creating or deleting login accounts needs the project's service-role key, which must never be
// shipped inside the app. This function holds it on the server, checks that the caller is signed
// in as an admin (user_roles.role = 'admin'), and only then makes the change.
//
// Deploy: Supabase Dashboard > Edge Functions > Deploy a new function > name "manage-users",
// paste this file, Deploy. (Or: supabase functions deploy manage-users)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge Functions automatically.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['admin', 'cashier', 'frontdesk'] as const;
type Role = (typeof ROLES)[number];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Who is asking?
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: callerData, error: callerError } = token ? await admin.auth.getUser(token) : { data: null, error: true };
  const caller = callerData?.user;
  if (callerError || !caller) return reply({ error: 'Please sign in again.' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply({ error: 'Invalid request' }, 400);
  }
  const action = body.action;

  // Anyone may change the name shown for their own account.
  if (action === 'update_own_name') {
    const fullName = String(body.fullName || '').trim();
    if (!fullName) return reply({ error: 'Please enter a name' }, 400);
    const { error } = await admin.from('user_roles').update({ full_name: fullName }).eq('user_id', caller.id);
    if (error) return reply({ error: error.message }, 400);
    await admin.auth.admin.updateUserById(caller.id, { user_metadata: { full_name: fullName } });
    return reply({ ok: true });
  }

  const { data: callerRole } = await admin.from('user_roles').select('role').eq('user_id', caller.id).maybeSingle();
  if (callerRole?.role !== 'admin') return reply({ error: 'Only an admin can manage users.' }, 403);

  /** True when `userId` is an admin and no other admin would be left. */
  const isLastAdmin = async (userId: string) => {
    const { data } = await admin.from('user_roles').select('user_id').eq('role', 'admin');
    const admins = (data || []).map((r) => r.user_id as string);
    return admins.includes(userId) && admins.length <= 1;
  };

  switch (action) {
    case 'create': {
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      const fullName = String(body.fullName || '').trim();
      const role: Role = isRole(body.role) ? body.role : 'cashier';
      if (!fullName) return reply({ error: 'Please enter a full name' }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Please enter a valid email' }, 400);
      if (password.length < 6) return reply({ error: 'Password must be at least 6 characters' }, 400);

      // Confirmed straight away: staff accounts are created by the admin, no email link needed.
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !data.user) {
        const exists = /already|registered|exists/i.test(error?.message || '');
        return reply({ error: exists ? 'A user with this email already exists' : error?.message || 'Could not create the user' }, 400);
      }

      const { error: roleError } = await admin
        .from('user_roles')
        .insert({ user_id: data.user.id, email, role, full_name: fullName });
      if (roleError) {
        // Don't leave a login without a role behind.
        await admin.auth.admin.deleteUser(data.user.id);
        return reply({ error: roleError.message }, 400);
      }
      return reply({ user: { id: data.user.id, email, fullName, role } });
    }

    case 'delete': {
      const userId = String(body.userId || '');
      if (!userId) return reply({ error: 'No user given' }, 400);
      if (userId === caller.id) return reply({ error: 'You cannot delete your own account' }, 400);
      if (await isLastAdmin(userId)) return reply({ error: 'The last admin cannot be deleted' }, 400);
      // Their user_roles row is removed with them (on delete cascade). Their past sales keep the
      // cashier name they were saved with.
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) return reply({ error: error.message }, 400);
      return reply({ ok: true });
    }

    case 'set_password': {
      const userId = String(body.userId || '');
      const password = String(body.password || '');
      if (!userId) return reply({ error: 'No user given' }, 400);
      if (password.length < 6) return reply({ error: 'Password must be at least 6 characters' }, 400);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return reply({ error: error.message }, 400);
      return reply({ ok: true });
    }

    case 'set_role': {
      const userId = String(body.userId || '');
      if (!userId) return reply({ error: 'No user given' }, 400);
      if (!isRole(body.role)) return reply({ error: 'Unknown role' }, 400);
      if (body.role !== 'admin') {
        if (userId === caller.id) return reply({ error: 'You cannot remove your own admin role' }, 400);
        if (await isLastAdmin(userId)) return reply({ error: 'The last admin cannot be changed to another role' }, 400);
      }
      const { error } = await admin.from('user_roles').update({ role: body.role }).eq('user_id', userId);
      if (error) return reply({ error: error.message }, 400);
      return reply({ ok: true });
    }

    default:
      return reply({ error: 'Unknown action' }, 400);
  }
});
