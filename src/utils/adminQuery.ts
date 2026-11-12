/**
 * Normalizes Strapi REST query params (`pagination[limit]`, `pagination[pageSize]`, etc.)
 * into Document Service `findMany` arguments (`limit`, `start`).
 * Defaults to `limit: -1` when no explicit pagination is requested so admin views
 * and dashboard aggregations are never silently truncated.
 */
export function buildAdminFindParams(query: Record<string, any> = {}): Record<string, any> & {
  limit: number;
  start?: number;
} {
  const { pagination, limit, start, ...rest } = query || {};

  let resolvedLimit: number | undefined;
  let resolvedStart: number | undefined = start !== undefined ? Number(start) : undefined;

  if (limit !== undefined) {
    resolvedLimit = Number(limit);
  } else if (pagination && typeof pagination === 'object') {
    if (pagination.limit !== undefined) {
      resolvedLimit = Number(pagination.limit);
    } else if (pagination.pageSize !== undefined) {
      resolvedLimit = Number(pagination.pageSize);
      const page = Math.max(1, Number(pagination.page || 1));
      resolvedStart = (page - 1) * resolvedLimit;
    }
    if (pagination.start !== undefined) {
      resolvedStart = Number(pagination.start);
    }
  }

  return {
    ...rest,
    limit: Number.isFinite(resolvedLimit as number) ? resolvedLimit : -1,
    ...(Number.isFinite(resolvedStart as number) ? { start: resolvedStart } : {}),
  };
}

