/**
 * Preload entry point. `tapedeck record` / `tapedeck replay --against` inject
 * it into the command with `--import`, so TapeDeck is active before any
 * application code runs and before any SDK client captures `fetch`. That is
 * what lets unmodified agents be recorded and replayed.
 *
 * It can also be used directly: `node --import tapedeck/register app.js`
 * (with the TAPEDECK_* environment variables set).
 */
import { installFetchInterceptor } from './interceptors/fetch.js';
import { activateFromEnv } from './runtime/env.js';

installFetchInterceptor();
activateFromEnv();
