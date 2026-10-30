/** Safe raw storage guard - idempotent D1 write check */
export function safeWrite(
  existingCount: number,
  newId: string
): { success: boolean; id?: string; error?: string; deduped: boolean } {
  if (existingCount > 0) {
    return { success: true, id: newId, deduped: true };
  }
  return { success: true, id: newId, deduped: false };
}