let nextId = 1;

export class JsonRpcError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = 'JsonRpcError';
  }
}

/** One JSON-RPC 2.0 POST over the given fetch. Returns `result` or throws. */
export async function jsonRpcCall(
  fetchFn: (input: string, init: RequestInit) => Promise<Response>,
  url: string,
  method: string,
  params: unknown[] = [],
  init: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    ...init,
  });
  if (!response.ok) throw new JsonRpcError(`RPC HTTP ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: { message?: string; code?: number } };
  if (body.error) throw new JsonRpcError(body.error.message ?? 'RPC error', body.error.code);
  return body.result;
}
