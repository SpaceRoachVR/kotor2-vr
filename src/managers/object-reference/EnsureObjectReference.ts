export interface ObjectReferenceIdentity {
  id?: number;
}

export interface EnsureObjectReferenceOptions<T extends ObjectReferenceIdentity> {
  object?: T;
  objectList: Map<number, T>;
  nextId(): number;
  invalidId: number;
}

/**
 * Register an object under a stable numeric identity without overwriting a
 * different object that already owns its requested ID.
 */
export function ensureObjectReference<T extends ObjectReferenceIdentity>(
  options: EnsureObjectReferenceOptions<T>
): number {
  const { object, objectList, nextId, invalidId } = options;
  if (!object) return invalidId;

  const requestedId = object.id;
  if (Number.isInteger(requestedId) && requestedId! > 0 && requestedId !== invalidId) {
    const registeredObject = objectList.get(requestedId!);
    if (!registeredObject || registeredObject === object) {
      objectList.set(requestedId!, object);
      return requestedId!;
    }
  }

  let assignedId = nextId();
  while (assignedId <= 0 || assignedId === invalidId || objectList.has(assignedId)) {
    assignedId = nextId();
  }
  object.id = assignedId;
  objectList.set(assignedId, object);
  return assignedId;
}
