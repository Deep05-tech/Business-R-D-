import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const scrypt = promisify(scryptCallback);

export type UserRole = "admin" | "user";
export interface AuthUser { username: string; role: UserRole; createdAt: string; }
interface StoredUser extends AuthUser { passwordHash: string; assignedProjectUrls?: string[]; }
interface Session { username: string; expiresAt: number; }

export class AuthStore {
  private users = new Map<string, StoredUser>();
  private sessions = new Map<string, Session>();
  private loaded = false;

  constructor(private readonly filePath = join("data", "auth", "users.json")) {}

  private normalizeUsername(username: string): string {
    return username.trim().toLowerCase();
  }

  private publicUser(user: StoredUser): AuthUser {
    return { username: user.username, role: user.role, createdAt: user.createdAt };
  }

  private async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const hash = (await scrypt(password, salt, 64)) as Buffer;
    return `${salt}:${hash.toString("hex")}`;
  }

  private async verifyPassword(password: string, encoded: string): Promise<boolean> {
    const [salt, hashHex] = encoded.split(":");
    if (!salt || !hashHex) return false;
    const actual = (await scrypt(password, salt, 64)) as Buffer;
    const expected = Buffer.from(hashHex, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  async initialize(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await readFile(this.filePath, "utf8");
      const users = JSON.parse(raw) as StoredUser[];
      for (const user of users) {
        if (user.username && user.passwordHash && (user.role === "admin" || user.role === "user")) {
          user.assignedProjectUrls = Array.isArray(user.assignedProjectUrls) ? user.assignedProjectUrls : [];
          this.users.set(this.normalizeUsername(user.username), user);
        }
      }
    } catch {
      // First run: bootstrap the existing configurable administrator account.
    }

    if (![...this.users.values()].some(user => user.role === "admin")) {
      const username = process.env.ADMIN_USERNAME || "admin";
      const password = process.env.ADMIN_PASSWORD || "admin123";
      if (process.env.NODE_ENV === "production" && password === "admin123") {
        console.error("CRITICAL SECURITY WARNING: Default administrator password (admin123) is active in PRODUCTION mode. Set ADMIN_PASSWORD in .env immediately.");
      }
      const admin: StoredUser = {
        username,
        role: "admin",
        createdAt: new Date().toISOString(),
        passwordHash: await this.hashPassword(password),
        assignedProjectUrls: []
      };
      this.users.set(this.normalizeUsername(username), admin);
      await this.persist();
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify([...this.users.values()], null, 2)}\n`, "utf8");
  }

  async authenticate(username: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    await this.initialize();
    const user = this.users.get(this.normalizeUsername(username));
    if (!user || !(await this.verifyPassword(password, user.passwordHash))) return null;
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, { username: user.username, expiresAt: Date.now() + 1000 * 60 * 60 * 12 });
    return { token, user: this.publicUser(user) };
  }

  async getSession(token: string | undefined): Promise<AuthUser | null> {
    await this.initialize();
    if (!token) return null;
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(token);
      return null;
    }
    const user = this.users.get(this.normalizeUsername(session.username));
    return user ? this.publicUser(user) : null;
  }

  revoke(token: string | undefined): void { if (token) this.sessions.delete(token); }

  async listUsers(): Promise<AuthUser[]> {
    await this.initialize();
    return [...this.users.values()].map(user => this.publicUser(user)).sort((a, b) => a.username.localeCompare(b.username));
  }

  async createUser(username: string, password: string, role: UserRole): Promise<AuthUser> {
    await this.initialize();
    const name = username.trim();
    const key = this.normalizeUsername(name);
    if (!/^[a-zA-Z0-9_.-]{3,48}$/.test(name)) throw new Error("Username must be 3-48 characters and use letters, numbers, dot, underscore, or hyphen.");
    if (password.length < 8) throw new Error("Password must contain at least 8 characters.");
    if (this.users.has(key)) throw new Error("That username already exists.");
    const user: StoredUser = { username: name, role, createdAt: new Date().toISOString(), passwordHash: await this.hashPassword(password), assignedProjectUrls: [] };
    this.users.set(key, user);
    await this.persist();
    return this.publicUser(user);
  }

  async deleteUser(username: string): Promise<boolean> {
    await this.initialize();
    const key = this.normalizeUsername(username);
    const user = this.users.get(key);
    if (!user) return false;
    if (user.role === "admin" && [...this.users.values()].filter(item => item.role === "admin").length <= 1) {
      throw new Error("At least one administrator account must remain.");
    }
    this.users.delete(key);
    for (const [token, session] of this.sessions) if (this.normalizeUsername(session.username) === key) this.sessions.delete(token);
    await this.persist();
    return true;
  }

  async assignedProjects(username: string): Promise<string[]> {
    await this.initialize();
    return [...(this.users.get(this.normalizeUsername(username))?.assignedProjectUrls || [])];
  }

  async usersAssignedToProject(projectUrl: string): Promise<string[]> {
    await this.initialize();
    return [...this.users.values()]
      .filter(user => user.assignedProjectUrls?.includes(projectUrl))
      .map(user => user.username)
      .sort((a, b) => a.localeCompare(b));
  }

  async assignProject(username: string, projectUrl: string): Promise<void> {
    await this.initialize();
    const user = this.users.get(this.normalizeUsername(username));
    if (!user) throw new Error("User not found.");
    user.assignedProjectUrls = [...new Set([...(user.assignedProjectUrls || []), projectUrl])];
    await this.persist();
  }

  async unassignProject(username: string, projectUrl: string): Promise<void> {
    await this.initialize();
    const user = this.users.get(this.normalizeUsername(username));
    if (!user) throw new Error("User not found.");
    user.assignedProjectUrls = (user.assignedProjectUrls || []).filter(url => url !== projectUrl);
    await this.persist();
  }

  async removeProjectFromAssignments(projectUrl: string): Promise<void> {
    await this.initialize();
    let changed = false;
    for (const user of this.users.values()) {
      const assignments = user.assignedProjectUrls || [];
      const filtered = assignments.filter(url => url !== projectUrl);
      if (filtered.length !== assignments.length) {
        user.assignedProjectUrls = filtered;
        changed = true;
      }
    }
    if (changed) await this.persist();
  }
}
