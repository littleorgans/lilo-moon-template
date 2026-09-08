/** Keep the outer `server` property literal in createFileRoute so Start can strip it from clients. */
export function postHandlers<Handler>(handler: Handler) {
  return {
    GET: (): Response => new Response(null, { status: 405, headers: { allow: "POST" } }),
    POST: handler,
  };
}
