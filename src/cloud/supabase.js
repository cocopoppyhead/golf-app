// Supabase client. The URL and publishable key are meant to be public (they ship in every
// app); data is protected by row-level security policies in supabase/schema.sql.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://uxigfgwznyalmyyrnsrh.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ZSbe6VCrxsY2VssOEPRLTQ_TNBsjV0F';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'golf.auth' },
});

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session?.user || null;
}

export async function signInPassword(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}
/** Returns the user if signed straight in; null if Supabase wants the email confirmed first. */
export async function signUpPassword(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  return data.session ? data.user : null;
}

/** Email a 6-digit code (creates the account the first time). */
export async function sendCode(email) {
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email, token) {
  const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw error;
  return data.user;
}

export const signOut = () => sb.auth.signOut();

export async function getProfile(uid) {
  const { data } = await sb.from('profiles').select('*').eq('id', uid).maybeSingle();
  return data;
}
export async function saveProfile(uid, fields) {
  const { error } = await sb.from('profiles').upsert({ id: uid, ...fields });
  if (error) throw error;
}
