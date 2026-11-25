// MOVA Miles settings. Fill these in from Supabase: Project Settings → API.
// The "anon public" key is designed to be public: the database rules decide what it can do.
window.MOVA_CONFIG = {
  supabaseUrl: "https://YOUR-PROJECT.supabase.co",
  supabaseAnonKey: "YOUR-ANON-PUBLIC-KEY",

  // Turn on once the Wallet card is set up with Passcreator (see SETUP.md, part 5).
  walletEnabled: false,
};
