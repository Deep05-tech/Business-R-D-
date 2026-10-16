import { describe, it, expect, afterEach } from "vitest";
import { AuthStore } from "./authStore.js";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("AuthStore", () => {
  const testFile = join(tmpdir(), `test-users-${Date.now()}.json`);

  afterEach(async () => {
    try { await unlink(testFile); } catch (_) {}
  });

  it("persists sessions cryptographically across restarts and auto-restores users", async () => {
    const store = new AuthStore(testFile);
    await store.initialize();

    // Create a new user
    await store.createUser("testuser", "securepass123", "admin");

    // Authenticate and get signed token
    const auth = await store.authenticate("testuser", "securepass123");
    expect(auth).not.toBeNull();
    expect(auth?.user.username).toBe("testuser");
    expect(auth?.token).toContain(".");

    // Simulate server reboot with new store instance
    const storeRebooted = new AuthStore(testFile);
    const session = await storeRebooted.getSession(auth?.token);
    expect(session).not.toBeNull();
    expect(session?.username).toBe("testuser");
    expect(session?.role).toBe("admin");

    // Simulate container redeploy where ephemeral filesystem was wiped of testuser
    (storeRebooted as any).users.delete("testuser");

    // Calling getSession should auto-restore testuser into this.users from signed token!
    const restoredSession = await storeRebooted.getSession(auth?.token);
    expect(restoredSession).not.toBeNull();
    expect(restoredSession?.username).toBe("testuser");
    expect(restoredSession?.role).toBe("admin");

    // Verify testuser is back in users list
    const users = await storeRebooted.listUsers();
    expect(users.some(u => u.username === "testuser")).toBe(true);
  });
});
