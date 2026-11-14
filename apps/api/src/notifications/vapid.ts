/**
 * Injection token of the VAPID public key, or null when it is not set.
 * Production requires it (compose.yml); without it, as in development,
 * the API answers 503 and the app does not offer notifications. The
 * private key is never here: only the worker signs a push.
 *
 * In its own file, not in the module: the module imports the controller,
 * so a token exported by the module is still undefined when the
 * controller's @Inject reads it.
 */
export const VAPID_PUBLIC_KEY = Symbol("VAPID_PUBLIC_KEY");
