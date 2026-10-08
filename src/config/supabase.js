import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL est manquante.');
}

if (!supabaseAnonKey) {
  throw new Error('SUPABASE_ANON_KEY est manquante.');
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY est manquante.',
  );
}

/// Client utilisant la clé publique.
///
/// Ce client sera utilisé lorsque nous voulons effectuer
/// des opérations au nom de l'utilisateur authentifié.
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
);

/// Client administrateur.
///
/// ATTENTION : cette clé ne doit JAMAIS être envoyée
/// à l'application Flutter.
///
/// Elle reste uniquement sur le serveur backend.
export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
