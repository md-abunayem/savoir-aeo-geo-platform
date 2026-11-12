import { test, expect } from "@playwright/test";

const projectId = "11111111-1111-4111-8111-111111111111";
test("edits live mockups, invalidates approval, reviews, approves and schedules a saved revision", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let draft = {
    id: projectId,
    revision: 1,
    status: "in_review",
    scheduled_time: null as string | null,
    validation: { passed: true, flaggedClaims: [], suggestions: [] } as {
      passed: boolean;
      flaggedClaims: unknown[];
      suggestions: string[];
    } | null,
    document: {
      brand_id: projectId,
      topic: "A clearer reporting routine",
      question: "How can we improve reporting?",
      intent: "educational",
      content: {
        facebook: { caption: "Build a clear reporting routine.", cta: "Review your workflow." },
        instagram: {
          caption: "A routine for better reports.",
          carousel_slides: ["Set a clear goal", "Review the results"],
        },
        x: { thread: ["Start with a goal.", "Review your results."] },
        short_video: {
          hook: "Make reporting clearer.",
          script: "Start with a goal.\nReview the results.\nDiscuss your next step.",
          scenes: [
            {
              visual: "A team reviewing reports",
              voiceover: "Start with your goal",
              duration_seconds: 5,
            },
          ],
        },
        podcast: {
          title: "Reporting routines",
          script: "Discussing practical routines.",
          show_notes: "Set goals and review results.",
        },
        blog: {
          title: "Clearer reports",
          answer_first_intro: "Begin with a clear goal.",
          sections: [{ heading: "Goals", body: "Decide what your report should answer." }],
          meta_description: "Practical reporting habits.",
        },
      },
    },
  };
  let scheduled = false;
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      method = route.request().method();
    let data: unknown;
    if (path === "/v1/auth/me")
      data = { user: { id: projectId, name: "Reviewer", email: "reviewer@test.invalid" } };
    else if (path === "/v1/auth/csrf") data = { csrfToken: "browser-test-token" };
    else if (path === "/v1/projects")
      data = {
        projects: [
          { id: projectId, tenantId: projectId, brandName: "Studio Brand", domain: "studio.test" },
        ],
      };
    else if (path.endsWith("/studio") && method === "GET")
      data = {
        drafts: [draft],
        connections: [
          {
            id: "buffer",
            provider: "buffer",
            channels: [
              { id: "x-channel", name: "Brand X", platform: "x" },
              { id: "ig-channel", name: "Brand Instagram", platform: "instagram" },
              { id: "yt-channel", name: "Brand Video", platform: "youtube" },
            ],
          },
        ],
        media: [
          {
            id: "image-1",
            mime_type: "image/png",
            public_url: "https://media.example/1.png",
            size_bytes: 100,
            ready: true,
          },
          {
            id: "image-2",
            mime_type: "image/png",
            public_url: "https://media.example/2.png",
            size_bytes: 100,
            ready: true,
          },
          {
            id: "video-1",
            mime_type: "video/mp4",
            public_url: "https://media.example/video.mp4",
            size_bytes: 100,
            ready: true,
          },
        ],
        deliveries: [],
        publishingEnabled: true,
      };
    else if (path.endsWith(`/drafts/${projectId}`) && method === "PUT") {
      const input = route.request().postDataJSON();
      expect(input.revision).toBe(draft.revision);
      draft = {
        ...draft,
        revision: draft.revision + 1,
        document: input.document,
        status: "draft",
        validation: null,
      };
      data = draft;
    } else if (path.endsWith("/review")) {
      draft = {
        ...draft,
        status: "in_review",
        validation: { passed: true, flaggedClaims: [], suggestions: [] },
      };
      data = draft;
    } else if (path.endsWith("/approve")) {
      draft = { ...draft, status: "approved" };
      data = draft;
    } else if (path.endsWith("/schedule")) {
      const input = route.request().postDataJSON();
      expect(input.revision).toBe(2);
      expect(input.targets[0]).toMatchObject({ platform: "x", channelId: "x-channel" });
      expect(input.targets[0].mediaIds).toEqual([]);
      expect(input.targets[1]).toMatchObject({
        platform: "instagram",
        mediaIds: ["image-1", "image-2"],
      });
      expect(input.targets[2]).toMatchObject({ platform: "youtube", mediaIds: ["video-1"] });
      scheduled = true;
      draft = { ...draft, status: "scheduled", scheduled_time: input.scheduledTime };
      data = draft;
    } else {
      await route.fulfill({ status: 404, json: { code: "UNEXPECTED_TEST_REQUEST", detail: path } });
      return;
    }
    await route.fulfill({
      json: { success: true, statusCode: 200, message: "Test response", data },
    });
  });
  await page.goto("/content/studio");
  await expect(
    page.getByRole("heading", { name: "A clearer reporting routine", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve revision", exact: true })).toBeEnabled();
  await page
    .getByRole("textbox", { name: "thread / 1", exact: true })
    .fill("Use a clearer reporting goal.");
  await expect(
    page.locator("article").filter({ hasText: "Use a clearer reporting goal." }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve revision", exact: true })).toBeDisabled();
  await page.screenshot({ path: "test-results/content-studio-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Instagram", exact: true }).click();
  await page.getByRole("button", { name: "Next slide" }).click();
  await expect(page.getByRole("heading", { name: "Review the results" })).toBeVisible();
  await page.getByRole("button", { name: "Video script", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save edits", exact: true }).click();
  await page.getByRole("button", { name: "Submit for review & check facts" }).click();
  await page.getByRole("button", { name: "Approve revision", exact: true }).click();
  await page.getByLabel(/Brand X/).check();
  await page.getByLabel("Brand Instagraminstagram", { exact: true }).check();
  await page.getByLabel("Brand Videoyoutube", { exact: true }).check();
  await page
    .getByRole("group", { name: "Attachments for Brand Instagram" })
    .getByRole("checkbox")
    .nth(0)
    .check();
  await page
    .getByRole("group", { name: "Attachments for Brand Instagram" })
    .getByRole("checkbox")
    .nth(1)
    .check();
  await page
    .getByRole("group", { name: "Attachments for Brand Video" })
    .getByRole("checkbox")
    .check();
  const date = new Date(Date.now() + 3600000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Publication time").fill(local);
  await page.getByRole("button", { name: "Schedule selected channels" }).click();
  await expect.poll(() => scheduled).toBe(true);
  await expect(page.getByRole("textbox", { name: "hook", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/content-studio-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
