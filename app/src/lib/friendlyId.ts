/**
 * Linear-style friendly IDs derived from Convex _id without a schema change.
 * Uses the last 6 characters of the document id, uppercased, prefixed.
 *   CONV-K9F2X1, MSG-A3B7C2, etc.
 */
export function friendlyId(prefix: string, convexId: string): string {
  const tail = convexId.slice(-6).toUpperCase();
  return `${prefix}-${tail}`;
}
