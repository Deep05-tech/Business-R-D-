import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getMongoDb } from "../utils/mongoClient.js";

const scrypt = promisify(scryptCallback);

export type UserRole = "admin" | "user";
export interface AuthUser { username: string; role: UserRole; createdAt: string; }
interface StoredUser extends AuthUser { passwordHash: string; assignedProjectUrls?: string[]; }
interface Session { username: string; expiresAt: number; }

export class AuthStore {
  private users = new Map<string, StoredUser>();
  private sessions = new Map<string, Session>();
  private loaded = false;

  constructor(private readonly filePath = process.env.DATA_DIR ? join(process.env.DATA_DIR, "auth", "users.json") : join("data", "auth", "users.json")) {}

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

    // 1. Try loading users from MongoDB first
    let dbInstance: any = null;
    try {
      dbInstance = await getMongoDb();
      if (dbInstance) {
        const dbUsers = await dbInstance.collection("users").find({}).toArray();
        for (const u of dbUsers) {
          const { _id, ...cleanUser } = u as any;
          if (cleanUser.username && cleanUser.passwordHash) {
            cleanUser.assignedProjectUrls = Array.isArray(cleanUser.assignedProjectUrls) ? cleanUser.assignedProjectUrls : [];
            this.users.set(this.normalizeUsername(cleanUser.username), cleanUser);
          }
        }
      }
    } catch (err: any) {
      console.warn("MongoDB user initialization failed:", err.message);
    }

    // 2. Load from local filesystem
    try {
      const raw = await readFile(this.filePath, "utf8");
      const users = JSON.parse(raw) as StoredUser[];
      for (const user of users) {
        if (user.username && user.passwordHash && (user.role === "admin" || user.role === "user")) {
          user.assignedProjectUrls = Array.isArray(user.assignedProjectUrls) ? user.assignedProjectUrls : [];
          const key = this.normalizeUsername(user.username);
          if (!this.users.has(key)) {
            this.users.set(key, user);
          }
        }
      }
    } catch {
      // First run: bootstrap the existing configurable administrator account.
    }

    const envAdminUser = (process.env.ADMIN_USERNAME || "admin").trim();
    const envAdminPass = process.env.ADMIN_PASSWORD;

    let admin = [...this.users.values()].find(user => user.role === "admin");
    if (!admin) {
      const username = envAdminUser;
      const password = envAdminPass || "admin123";
      if (process.env.NODE_ENV === "production" && password === "admin123") {
        console.error("CRITICAL SECURITY WARNING: Default administrator password (admin123) is active in PRODUCTION mode. Set ADMIN_PASSWORD in .env immediately.");
      }
      admin = {
        username,
        role: "admin",
        createdAt: new Date().toISOString(),
        passwordHash: await this.hashPassword(password),
        assignedProjectUrls: []
      };
      this.users.set(this.normalizeUsername(username), admin);
      await this.persist();
    } else if (envAdminPass) {
      // If an administrator password was explicitly passed via environment variable (e.g. Render config),
      // synchronize admin credentials with the configured environment!
      const currentPasswordValid = await this.verifyPassword(envAdminPass, admin.passwordHash);
      const usernameChanged = admin.username.toLowerCase() !== envAdminUser.toLowerCase();
      if (!currentPasswordValid || usernameChanged) {
        if (usernameChanged) {
          this.users.delete(this.normalizeUsername(admin.username));
          admin.username = envAdminUser;
        }
        admin.passwordHash = await this.hashPassword(envAdminPass);
        this.users.set(this.normalizeUsername(admin.username), admin);
        await this.persist();
      }
    }

    // Support SEED_USERS / AUTH_USERS env var (format: "user1:pass1:role1,user2:pass2:role2" or JSON)
    // Allows persistent users on platforms with ephemeral containers (Render, Railway, Fly, Heroku)
    const seedUsersEnv = process.env.SEED_USERS || process.env.AUTH_USERS;
    if (seedUsersEnv) {
      try {
        let changed = false;
        if (seedUsersEnv.trim().startsWith("[")) {
          const list = JSON.parse(seedUsersEnv);
          for (const u of list) {
            const key = this.normalizeUsername(u.username);
            const existing = this.users.get(key);
            if (!existing) {
              this.users.set(key, {
                username: u.username.trim(),
                role: u.role === "admin" ? "admin" : "user",
                createdAt: new Date().toISOString(),
                passwordHash: await this.hashPassword(u.password),
                assignedProjectUrls: u.assignedProjectUrls || []
              });
              changed = true;
            } else if (u.password && !(await this.verifyPassword(u.password, existing.passwordHash))) {
              existing.passwordHash = await this.hashPassword(u.password);
              changed = true;
            }
          }
        } else {
          const entries = seedUsersEnv.split(",").map(e => e.trim()).filter(Boolean);
          for (const entry of entries) {
            const [uName, uPass, uRole] = entry.split(":").map(s => s.trim());
            if (uName && uPass) {
              const key = this.normalizeUsername(uName);
              const existing = this.users.get(key);
              if (!existing) {
                this.users.set(key, {
                  username: uName,
                  role: uRole === "admin" ? "admin" : "user",
                  createdAt: new Date().toISOString(),
                  passwordHash: await this.hashPassword(uPass),
                  assignedProjectUrls: []
                });
                changed = true;
              } else if (!(await this.verifyPassword(uPass, existing.passwordHash))) {
                existing.passwordHash = await this.hashPassword(uPass);
                changed = true;
              }
            }
          }
        }
        if (changed) {
          await this.persist();
        }
      } catch (err) {
        console.error("Failed to parse SEED_USERS / AUTH_USERS env variable:", err);
      }
    }

    // Sync any newly initialized users back to MongoDB
    if (dbInstance && this.users.size > 0) {
      try {
        for (const user of this.users.values()) {
          await dbInstance.collection("users").updateOne(
            { username: user.username },
            { $set: user },
            { upsert: true }
          );
        }
      } catch {}
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify([...this.users.values()], null, 2)}\n`, "utf8");

    try {
      const db = await getMongoDb();
      if (db) {
        for (const user of this.users.values()) {
          await db.collection("users").updateOne(
            { username: user.username },
            { $set: user },
            { upsert: true }
          );
        }
      }
    } catch (err: any) {
      console.warn("MongoDB user sync failed:", err.message);
    }
  }

  private getSessionSecret(): string {
    return (process.env.SESSION_SECRET || "business-rd-fixed-session-key-v2-2026").trim();
  }

  private createSignedToken(user: { username: string; role: UserRole; passwordHash: string }, expiresAt: number): string {
    const payload = Buffer.from(JSON.stringify({
      username: user.username,
      role: user.role,
      passwordHash: user.passwordHash,
      expiresAt
    })).toString("base64url");
    const signature = createHmac("sha256", this.getSessionSecret()).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private verifySignedToken(token: string): { username: string; role?: UserRole; passwordHash?: string; expiresAt: number } | null {
    try {
      const parts = token.split(".");
      if (parts.length !== 2) return null;
      const [payload, signature] = parts;
      const expectedSig = createHmac("sha256", this.getSessionSecret()).update(payload).digest("base64url");
      if (signature !== expectedSig) return null;
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (typeof data.expiresAt !== "number" || data.expiresAt <= Date.now()) return null;
      return data;
    } catch {
      return null;
    }
  }

  async authenticate(username: string, password: string): Promise<{ token: string; user: AuthUser } | null> {
    await this.initialize();
    const user = this.users.get(this.normalizeUsername(username));
    if (!user || !(await this.verifyPassword(password, user.passwordHash))) return null;
    const expiresAt = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days persistent session
    const token = this.createSignedToken({ username: user.username, role: user.role, passwordHash: user.passwordHash }, expiresAt);
    this.sessions.set(token, { username: user.username, expiresAt });
    return { token, user: this.publicUser(user) };
  }

  async getSession(token: string | undefined): Promise<AuthUser | null> {
    await this.initialize();
    if (!token) return null;

    let session = this.sessions.get(token);
    let tokenData: { username: string; role?: UserRole; passwordHash?: string; expiresAt: number } | null = null;
    if (!session) {
      // Memory cache miss (e.g. server redeployed or restarted). Verify signed cryptographic token!
      tokenData = this.verifySignedToken(token);
      if (tokenData) {
        session = { username: tokenData.username, expiresAt: tokenData.expiresAt };
        this.sessions.set(token, session);
      }
    }

    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.sessions.delete(token);
      return null;
    }

    let user = this.users.get(this.normalizeUsername(session.username));
    if (!user) {
      if (!tokenData) {
        tokenData = this.verifySignedToken(token);
      }
      if (tokenData?.passwordHash) {
        user = {
          username: tokenData.username,
          role: tokenData.role || "user",
          passwordHash: tokenData.passwordHash,
          createdAt: new Date().toISOString(),
          assignedProjectUrls: []
        };
        this.users.set(this.normalizeUsername(user.username), user);
        await this.persist();
      }
    }

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
    try {
      const db = await getMongoDb();
      if (db) {
        await db.collection("users").deleteOne({ username: user.username });
      }
    } catch {}
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
    if (!projectUrl) return;
    const normalize = (u: string) => (u || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    const targetNorm = normalize(projectUrl);

    let changed = false;
    for (const user of this.users.values()) {
      const assignments = user.assignedProjectUrls || [];
      const filtered = assignments.filter(url => {
        if (!url) return false;
        if (url === projectUrl) return false;
        const uNorm = normalize(url);
        return uNorm !== targetNorm;
      });
      if (filtered.length !== assignments.length) {
        user.assignedProjectUrls = filtered;
        changed = true;
      }
    }
    if (changed) await this.persist();
  }
}
