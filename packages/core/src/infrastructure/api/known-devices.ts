import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Devices the user has let in, and the secret each of them was given.
 *
 * Not a password: nobody types anything. A device arrives unknown, the user
 * approves it once by sight, and from then on it identifies itself with a
 * token of its own. Revoking one device therefore does not disturb the others,
 * which a shared password could never manage.
 */

export interface KnownDevice {
  readonly id: string;
  readonly name: string;
  /** Secret this device authenticates with; never leaves the daemon twice. */
  readonly token: string;
  readonly approvedAt: string;
}

const FILE = 'devices.json';
const TOKEN_BYTES = 32;

export class KnownDevices {
  private devices = new Map<string, KnownDevice>();
  private loaded = false;

  constructor(private readonly configDirectory: string) {}

  private get file(): string {
    return join(this.configDirectory, FILE);
  }

  async all(): Promise<readonly KnownDevice[]> {
    await this.load();
    return [...this.devices.values()];
  }

  /** The device this token belongs to, if any. */
  async byToken(token: string | undefined): Promise<KnownDevice | undefined> {
    if (!token) return undefined;
    await this.load();

    for (const device of this.devices.values()) {
      // Length-independent comparison is pointless here: the tokens are all
      // the same length, and the id is not a secret.
      if (device.token === token) return device;
    }

    return undefined;
  }

  /** Lets a device in and mints its token. */
  async approve(id: string, name: string): Promise<KnownDevice> {
    await this.load();

    const device: KnownDevice = {
      id,
      name,
      token: randomBytes(TOKEN_BYTES).toString('hex'),
      approvedAt: new Date().toISOString(),
    };

    this.devices.set(id, device);
    await this.save();
    return device;
  }

  async revoke(id: string): Promise<void> {
    await this.load();
    if (!this.devices.delete(id)) return;
    await this.save();
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      if (!Array.isArray(raw)) return;

      for (const entry of raw) {
        const device = entry as Partial<KnownDevice>;
        if (typeof device.id !== 'string' || typeof device.token !== 'string') continue;

        this.devices.set(device.id, {
          id: device.id,
          name: typeof device.name === 'string' ? device.name : device.id,
          token: device.token,
          approvedAt: typeof device.approvedAt === 'string' ? device.approvedAt : '',
        });
      }
    } catch {
      // No file yet, or one nobody can read: an empty list is the honest
      // answer, and the next approval writes a fresh one.
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify([...this.devices.values()], null, 2), 'utf8');
  }
}
