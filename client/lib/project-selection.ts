export function selectedProject(userId: string) {
  try {
    return localStorage.getItem(`savoir:project:${userId}`) ?? "";
  } catch {
    return "";
  }
}
export function selectProject(userId: string, projectId: string) {
  try {
    localStorage.setItem(`savoir:project:${userId}`, projectId);
  } catch {
    /* Storage may be disabled. */
  }
}
export function projectRequestKey(
  userId: string,
  operation: string,
  payload: unknown,
) {
  const fingerprint = JSON.stringify(payload),
    storageKey = `savoir:request:${userId}:${operation}`;
  try {
    const old = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (old?.fingerprint === fingerprint && typeof old.key === "string")
      return old.key as string;
    const key = crypto.randomUUID();
    sessionStorage.setItem(storageKey, JSON.stringify({ key, fingerprint }));
    return key;
  } catch {
    return crypto.randomUUID();
  }
}
export function clearProjectRequest(userId: string, operation: string) {
  try {
    sessionStorage.removeItem(`savoir:request:${userId}:${operation}`);
  } catch {
    /* Storage may be disabled. */
  }
}
