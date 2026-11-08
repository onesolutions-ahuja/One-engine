import type * as React from 'react';

/**
 * Compile an already-authorised component source in the execution context
 * selected by the caller. Trusted package sources run in the host; tenant
 * sources MUST be invoked only inside the isolated sandbox frame.
 *
 * This helper does not make arbitrary JSX safe: the trust boundary is enforced
 * by RegisteredComponent and ComponentSandbox, not by this compiler.
 */
export function compileComponentModule(
  compiledJs: string,
  react: typeof React
): React.ComponentType<Record<string, unknown>> {
  if (typeof compiledJs !== 'string' || !compiledJs.trim()) {
    throw new Error('Missing registered component source');
  }
  const module: { exports: { default?: unknown } } = { exports: {} };
  const execute = new Function('React', 'module', 'exports', compiledJs) as (
    runtime: typeof React, componentModule: typeof module, exports: typeof module.exports
  ) => void;
  execute(react, module, module.exports);
  if (typeof module.exports.default !== 'function') {
    throw new Error('The registered default export is not a React component');
  }
  return module.exports.default as React.ComponentType<Record<string, unknown>>;
}
