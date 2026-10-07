/** Any value Postgres stores in a jsonb column. Replaces Supabase's generated Json type. */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
