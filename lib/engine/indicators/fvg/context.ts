import type { F4ContextEvalResult, F4ContextInput } from "./types";

export type F4ContextProvider = (input: F4ContextInput) => boolean;

export function evaluateF4Context(
  input: F4ContextInput,
  provider?: F4ContextProvider
): F4ContextEvalResult {
  if (!provider) {
    return {
      source: "NONE",
      passF4: false,
    };
  }

  return {
    source: "PROVIDER",
    passF4: Boolean(provider(input)),
  };
}
