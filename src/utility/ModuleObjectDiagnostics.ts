/** Primitive snapshots keep diagnostics from retaining disposed engine graphs. */
interface DiagnosticObject {
  getTemplateResRef?(): string;
  getTag?(): string;
  id: number;
  objectType: number;
}

function readIdentity(read: () => unknown): string {
  try {
    const value = read();
    return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
      ? String(value) : 'unknown';
  } catch {
    // Rooms and partially constructed objects can have no template yet.
    // Logging must never interrupt teardown or retain the failed getter's object.
    return 'unknown';
  }
}

export function describeModuleObject(object: DiagnosticObject | null | undefined): string {
  if(!object) return 'found=false ResRef=unknown Tag=unknown ID=unknown Type=unknown';
  return `found=true ResRef=${readIdentity(() => object.getTemplateResRef?.())} Tag=${readIdentity(() => object.getTag?.())} ID=${readIdentity(() => object.id)} Type=${readIdentity(() => object.objectType)}`;
}
