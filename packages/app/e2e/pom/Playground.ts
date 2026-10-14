import { expect, type Page } from "@playwright/test";
import { TextField } from "./TextField.ts";

type Replica = 1 | 2;

/** The playground: two local replicas of a draft, syncing with each other. */
export class Playground {
  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private readonly editor = (replica: Replica, field: "title" | "body") =>
    this.page.getByRole("textbox", { name: `Replica ${replica} ${field}` });

  async goto(): Promise<void> {
    await this.page.goto("/playground");
  }

  field(replica: Replica, field: "title" | "body"): TextField {
    return new TextField(this.editor(replica, field));
  }

  /** What a replica holds, as its JSON shows it. */
  async json(replica: Replica): Promise<{ title: string; body: string }> {
    return JSON.parse(
      (await this.page.getByTestId(`Replica ${replica} json`).textContent()) ??
        "",
    ) as { title: string; body: string };
  }

  async expectJson(
    replica: Replica,
    json: { title: string; body: string },
  ): Promise<void> {
    await expect.poll(() => this.json(replica)).toEqual(json);
  }

  async disconnect(): Promise<void> {
    await this.page.getByLabel("Replicas connected").uncheck();
  }

  async connect(): Promise<void> {
    await this.page.getByLabel("Replicas connected").check();
  }

  /** Marks a field's element, to tell later whether it was made anew. */
  async markField(replica: Replica, field: "title" | "body"): Promise<void> {
    await this.editor(replica, field).evaluate((element) => {
      (element as HTMLElement & { marker?: boolean }).marker = true;
    });
  }

  async expectFieldMarked(
    replica: Replica,
    field: "title" | "body",
  ): Promise<void> {
    expect(
      await this.editor(replica, field).evaluate(
        (element) => (element as HTMLElement & { marker?: boolean }).marker,
      ),
    ).toBe(true);
  }
}
