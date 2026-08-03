/** Compile-time deployment mode boundary for browser-safe code. */
export const productionBuild = process.env.NODE_ENV === "production";
