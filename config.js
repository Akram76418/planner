/* Accounts + sync settings. SUPABASE_ANON_KEY is the public publishable key (safe in the browser). Never put a secret/service_role key here. */
window.PLANNER_CONFIG = {
  SUPABASE_URL: 'https://kfxclzkmuugadkiuwvdp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_n5hsD3IcWdUyBz9p0trIiA_ihQfJ00s',
  VAPID_PUBLIC_KEY: 'BIrNqKTyRD7noEblDyYaAe0aSM_RvDXciMY5JeJmKE90B341SVO3xdXZ-AJK9l0V0SODeuzNzE6NTt1oUqI8LPc',   // optional: Web Push public key
  ADMIN_FN: 'super-task'   // slug of the account-creation Edge Function
};
