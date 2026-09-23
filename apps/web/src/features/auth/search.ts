/** Keep absent flags absent so router URL normalization converges. */
export function retrySearch(search: Record<string, unknown>): { readonly retry?: true } {
  return search["retry"] === true ? { retry: true } : {};
}
