import type { FolderDefinition, PageDefinition, ProfileDefinition } from './profile.js';

/**
 * Indexed view over a profile's folder tree.
 *
 * Navigation asks the same three questions constantly — where is this folder,
 * what is above it, which page is this — and answering them by walking the
 * tree each time would put recursion in the middle of every key press. Built
 * once per loaded profile, thrown away with it.
 */
export class ProfileTree {
  private readonly folders = new Map<string, FolderDefinition>();
  private readonly parents = new Map<string, string>();
  private readonly pageOwners = new Map<string, string>();
  private readonly pages = new Map<string, PageDefinition>();

  constructor(private readonly profile: ProfileDefinition) {
    this.index(profile.root, undefined);
  }

  get root(): FolderDefinition {
    return this.profile.root;
  }

  folder(id: string): FolderDefinition | undefined {
    return this.folders.get(id);
  }

  page(id: string): PageDefinition | undefined {
    return this.pages.get(id);
  }

  /** The folder a page belongs to. */
  ownerOf(pageId: string): FolderDefinition | undefined {
    const owner = this.pageOwners.get(pageId);
    return owner === undefined ? undefined : this.folders.get(owner);
  }

  parentOf(folderId: string): FolderDefinition | undefined {
    const parent = this.parents.get(folderId);
    return parent === undefined ? undefined : this.folders.get(parent);
  }

  /** Root first, the folder itself last — the breadcrumb a UI shows. */
  pathTo(folderId: string): FolderDefinition[] {
    const path: FolderDefinition[] = [];
    let current = this.folders.get(folderId);

    while (current) {
      path.unshift(current);
      const parentId = this.parents.get(current.id);
      current = parentId === undefined ? undefined : this.folders.get(parentId);
    }

    return path;
  }

  firstPageOf(folderId: string): PageDefinition | undefined {
    return this.folders.get(folderId)?.pages[0];
  }

  /** Every folder, depth first — for listings and validation. */
  allFolders(): FolderDefinition[] {
    return [...this.folders.values()];
  }

  private index(folder: FolderDefinition, parentId: string | undefined): void {
    this.folders.set(folder.id, folder);
    if (parentId !== undefined) this.parents.set(folder.id, parentId);

    for (const page of folder.pages) {
      this.pages.set(page.id, page);
      this.pageOwners.set(page.id, folder.id);
    }

    for (const child of folder.folders ?? []) this.index(child, folder.id);
  }
}
