import { expect, type Page } from "@playwright/test";

/** The copies of drafts the studio keeps in the browser's IndexedDB. */
export class LocalCopies {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async expectSome(): Promise<void> {
    await expect.poll(() => this.count()).toBeGreaterThan(0);
  }

  async expectNone(): Promise<void> {
    expect(await this.count()).toBe(0);
  }

  private count() {
    return this.page.evaluate(async () => {
      let count = 0;
      for (const { name } of await indexedDB.databases()) {
        if (name === undefined || !name.startsWith("skjera ")) continue;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (db.objectStoreNames.contains("documents")) {
          count += await new Promise<number>((resolve, reject) => {
            const request = db
              .transaction("documents")
              .objectStore("documents")
              .count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        }
        db.close();
      }
      return count;
    });
  }
}
