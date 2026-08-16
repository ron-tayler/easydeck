import { ArchivePluginSource } from './archive-plugin-source.js';

/**
 * The plugins repository as it is published: a GitHub release.
 *
 * Everything a store needs is attached to one release — the index and one
 * archive per plugin — and fetched from `releases/latest/download/<name>`,
 * an address GitHub resolves to the newest release on its own. That choice
 * is what keeps this simple:
 *
 * - no API, no token and no rate limit for a public repository, because
 *   these are plain file downloads;
 * - no built artifacts committed to the repository, which is what the
 *   plugins repository set out to avoid;
 * - nothing to update when a release is published — the address is the same
 *   one it was yesterday.
 *
 * The index it reads is the same file the local folder serves, because the
 * index names files rather than places. Which source a build uses is a
 * decision made once, in the composition root.
 */

const DEFAULT_OWNER = 'ron-tayler';
const DEFAULT_REPO = 'easydeck-plugins';

/**
 * How long to wait for GitHub.
 *
 * Generous for an archive on a slow connection, short enough that a store
 * opened on a train says so rather than sitting blank.
 */
const TIMEOUT_MS = 30_000;

export interface GitHubSourceOptions {
  readonly owner?: string;
  readonly repo?: string;
  /**
   * A particular release rather than whatever is newest.
   *
   * For pinning a build to a known set of plugins, and for testing against a
   * release that is not the current one.
   */
  readonly tag?: string;
  /** Overridden by tests, which have no network and want none. */
  readonly fetcher?: typeof fetch;
}

export class GitHubPluginSource extends ArchivePluginSource {
  readonly name = 'github';

  private readonly base: string;
  private readonly fetcher: typeof fetch;

  constructor(options: GitHubSourceOptions = {}) {
    super();

    const owner = options.owner ?? DEFAULT_OWNER;
    const repo = options.repo ?? DEFAULT_REPO;
    const release = options.tag ? `download/${options.tag}` : 'latest/download';

    this.base = `https://github.com/${owner}/${repo}/releases/${release}`;
    this.fetcher = options.fetcher ?? fetch;
  }

  protected async fetch(name: string): Promise<Uint8Array | undefined> {
    // Names come from the index this same source published, but they are still
    // names from a file: one containing a slash would address a different
    // release, or a different repository.
    if (name.includes('/') || name.includes('..')) return undefined;

    try {
      const response = await this.fetcher(`${this.base}/${encodeURIComponent(name)}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'application/octet-stream' },
      });

      // 404 is the ordinary answer before the first release exists, and a
      // store with nothing on the shelf is what should be shown for it.
      if (!response.ok) return undefined;

      return new Uint8Array(await response.arrayBuffer());
    } catch {
      // No network, DNS refused, a captive portal: an empty shelf, not a
      // window that will not open.
      return undefined;
    }
  }
}
