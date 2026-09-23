import { currentSession } from '../runtime/context.js';

/**
 * Returns a proxy of `client` whose methods at the given dotted paths
 * (e.g. `chat.completions.create`) are routed through the current session.
 * Everything else is passed through untouched.
 *
 * Intercepted methods return a plain Promise rather than the SDK's
 * enhanced promise type, so helpers such as `.withResponse()` are not
 * available on intercepted calls.
 */
export function wrapClient<T extends object>(client: T, provider: string, operations: readonly string[]): T {
  const cache = new WeakMap<object, object>();

  const wrap = (target: object, prefix: string): object => {
    const cached = cache.get(target);
    if (cached) return cached;
    const proxy = new Proxy(target, {
      get(obj, prop) {
        // Read with the real object as receiver so getters and #private fields work.
        const value: unknown = Reflect.get(obj, prop, obj);
        if (typeof prop !== 'string') return value;
        const path = prefix ? `${prefix}.${prop}` : prop;

        if (typeof value === 'function') {
          const fn = value as (...args: unknown[]) => unknown;
          if (!operations.includes(path)) return fn.bind(obj);
          return (...args: unknown[]) => {
            const invoke = async () => fn.apply(obj, args);
            const session = currentSession();
            if (!session) return fn.apply(obj, args);
            return session.llm({ provider, operation: path, request: args[0] }, invoke);
          };
        }
        if (typeof value === 'object' && value !== null && operations.some((op) => op.startsWith(`${path}.`))) {
          return wrap(value, path);
        }
        return value;
      },
    });
    cache.set(target, proxy);
    return proxy;
  };

  return wrap(client, '') as T;
}
