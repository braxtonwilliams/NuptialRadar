import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
let ready = false;

export function isSupabaseConfigured(): boolean {
  return Boolean(url && anonKey);
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    if (!url || !anonKey) {
      throw new Error(
        'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
      );
    }
    client = createClient(url, anonKey);
  }
  return client;
}

export function isSupabaseReady(): boolean {
  return ready;
}

/** Anonymous auth + session restore so sightings persist per browser. */
export async function initSupabase(): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.warn('Supabase env vars missing — sightings sync disabled.');
    return;
  }

  const supabase = getSupabase();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  if (!sessionData.session) {
    const { error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) throw signInError;
  }

  ready = true;
}
