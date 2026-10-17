/** `next/headers` in the Modal bundle: there is no cookie session here, every call says so. */
export function cookies(): never {
  throw new Error("No cookie session in the MCP server: pass the caller's Supabase client instead.");
}

export function headers(): never {
  throw new Error("No Next request in the MCP server.");
}
