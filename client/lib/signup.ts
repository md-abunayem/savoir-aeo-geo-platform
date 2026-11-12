export function passwordError(password: string): string {
  if ([...password].length < 15) return "Use at least 15 characters for your password.";
  if (new TextEncoder().encode(password).length > 72)
    return "Use a password of at most 72 UTF-8 bytes. Some characters use more than one byte.";
  return "";
}
