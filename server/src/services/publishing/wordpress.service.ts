import { z } from "zod";
import type { StudioDocument } from "../content/content-studio.schema.js";
import { publicHttpsRequest } from "./public-http.js";
import { PublishingError } from "./publishing.validation.js";

export interface WordPressCredentials {
  siteUrl: string;
  username: string;
  applicationPassword: string;
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export class WordPressService {
  constructor(private readonly transport = publicHttpsRequest) {}
  private async request(
    credentials: WordPressCredentials,
    path: string,
    method = "GET",
    data?: unknown,
  ) {
    const origin = new URL(credentials.siteUrl);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    )
      throw new PublishingError("INVALID_CMS_URL");
    const url = new URL(
      `${origin.pathname.replace(/\/$/, "")}/wp-json/wp/v2/${path}`,
      origin.origin,
    );
    const response = await this.transport(url, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.applicationPassword}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    if (response.status === 429)
      throw new PublishingError(
        "CMS_RATE_LIMITED",
        Math.max(1, Number(response.headers.get("retry-after")) || 60),
      );
    if (!response.ok)
      throw new PublishingError(
        "CMS_HTTP_ERROR",
        undefined,
        method === "POST" && response.status >= 500,
      );
    try {
      return await response.json();
    } catch {
      throw new PublishingError("CMS_INVALID_RESPONSE", undefined, method === "POST");
    }
  }
  async verify(credentials: WordPressCredentials) {
    await this.request(credentials, "users/me?context=edit");
    const schema = (await this.request(credentials, "posts", "OPTIONS")) as {
      schema?: { properties?: { meta?: { properties?: Record<string, unknown> } } };
    };
    if (!schema.schema?.properties?.meta?.properties?.savoir_schema_json)
      throw new PublishingError("WORDPRESS_SCHEMA_PLUGIN_REQUIRED");
  }
  async publish(credentials: WordPressCredentials, document: StudioDocument, deliveryId: string) {
    const blog = document.content.blog;
    const schema = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: blog.title,
      description: blog.meta_description,
    };
    const slug = `savoir-${deliveryId}`;
    // Reconcile a completed request by stable slug before attempting a new create.
    const existing = await this.request(credentials, `posts?slug=${slug}&context=edit`);
    const posts = z
      .array(z.object({ id: z.number(), link: z.string(), status: z.string() }).passthrough())
      .parse(existing);
    if (posts[0]) {
      if (posts[0].status !== "publish")
        throw new PublishingError("CMS_EXISTING_POST_NOT_PUBLISHED");
      try {
        const meta = posts[0].meta as { savoir_schema_json?: string } | undefined;
        if (JSON.stringify(JSON.parse(meta?.savoir_schema_json ?? "")) !== JSON.stringify(schema))
          throw new Error("Schema mismatch");
      } catch {
        throw new PublishingError("CMS_EXISTING_SCHEMA_MISMATCH", undefined, true);
      }
      return posts[0];
    }
    await this.verify(credentials);
    const content =
      `<p>${escapeHtml(blog.answer_first_intro)}</p>` +
      blog.sections
        .map(
          (section) =>
            `<h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body).replace(/\n/g, "<br>")}</p>`,
        )
        .join("");
    const result = await this.request(credentials, "posts", "POST", {
      title: blog.title,
      content,
      excerpt: blog.meta_description,
      status: "publish",
      slug,
      meta: { savoir_schema_json: JSON.stringify(schema) },
    });
    try {
      const post = z
        .object({
          id: z.number(),
          link: z.string(),
          status: z.literal("publish"),
          meta: z.object({ savoir_schema_json: z.string() }),
        })
        .passthrough()
        .parse(result);
      if (JSON.stringify(JSON.parse(post.meta.savoir_schema_json)) !== JSON.stringify(schema))
        throw new Error("Schema not stored");
      return post;
    } catch {
      throw new PublishingError("CMS_PUBLICATION_REQUIRES_RECONCILIATION", undefined, true);
    }
  }
}
