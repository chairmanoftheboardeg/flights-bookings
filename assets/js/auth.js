/* global EGR_CONFIG */
let supabaseClient = null;

async function initSupabase(){
  const { createClient } = window.supabase;
  supabaseClient = createClient(EGR_CONFIG.SUPABASE_URL, EGR_CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return supabaseClient;
}

async function getSession(){
  const { data } = await supabaseClient.auth.getSession();
  return data.session || null;
}

async function signIn(email, password){
  return await supabaseClient.auth.signInWithPassword({ email, password });
}

async function signUp(email, password){
  return await supabaseClient.auth.signUp({ email, password });
}

async function signOut(){
  return await supabaseClient.auth.signOut();
}

function onAuthStateChange(cb){
  supabaseClient.auth.onAuthStateChange((_event, session)=>cb(session));
}
