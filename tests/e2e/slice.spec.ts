import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

// Only used by the explicitly configured, dedicated learner scenario below.
// Review-first now applies to an account that retained older test words.
async function checkDueReviews(page: Page) {
  for (let i = 0; i < 150; i++) {
    await expect(page.getByRole("button", { name: "Refresh review queue", exact: true })).toBeVisible();
    const firstResult = page.getByRole("button", { name: "Forgot", exact: true });
    const partial = page.getByRole("button", { name: "Save Day +7 first sentence", exact: true });
    const reveal = page.getByRole("button", { name: "Reveal saved answer", exact: true });
    if (!await firstResult.isVisible() && !await partial.isVisible() && !await reveal.isVisible()) return;
    const sentence = page.getByLabel(/New independent sentence/);
    if (await sentence.isVisible()) await sentence.fill("This is an independent sentence in a dedicated automated test.");
    if (await partial.isVisible()) await partial.click();
    else if (await firstResult.isVisible()) await firstResult.click();
    await reveal.click();
    await page.getByRole("button", { name: "I checked the answer and corrected mistakes", exact: true }).click();
    await expect(reveal).toHaveCount(0);
  }
  throw new Error("Dedicated test learner has too many pending review cards for this scenario.");
}

test("private pages redirect to sign-in; login works on desktop and mobile widths", async ({ page }) => {
  for (const path of ["/", "/session", "/words", "/review"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
  }
  await page.screenshot({ path: "test-results/login-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Sign in →" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/login-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("live learner can recover, save, close unfinished work, keep history, and sign out", async ({ page }) => {
  test.setTimeout(120000);
  test.skip(!process.env.TEST_LEARNER_EMAIL || !process.env.TEST_LEARNER_PASSWORD, "Requires a dedicated Supabase test learner and applied migration; never uses service-role credentials.");
  await page.goto("/login");
  await page.getByLabel("Email address").fill(process.env.TEST_LEARNER_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.TEST_LEARNER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in →" }).click();
  await expect(page.getByRole("heading", { name: /Small steps/ })).toBeVisible();
  const exceptionalChoice = page.getByLabel("I choose exceptional new-word study today.");
  if (await exceptionalChoice.isVisible()) await exceptionalChoice.check();
  await page.getByRole("button", { name: /Start Your Routine Today|Resume your draft/ }).click();
  await expect(page).toHaveURL(/\/session$/);
  // A dedicated test account may retain a previous test's active draft.
  // Close it through the real lifecycle before starting an independent fixture.
  await page.getByRole("button", { name: "Close unfinished session", exact: true }).click();
  await page.getByRole("button", { name: "Close & keep history", exact: true }).click();
  await expect(page.getByText("No active draft. Start a new session whenever you are ready.")).toBeVisible();
  const freshException = page.getByLabel("I choose exceptional new-word study today.");
  if (await freshException.isVisible()) await freshException.check();
  await page.getByRole("button", { name: "Start Your Routine Today →", exact: true }).click();
  const reviewChoice = page.getByRole("button", { name: "Choose exceptional new-word study" });
  await checkDueReviews(page);
  if (await reviewChoice.isVisible()) await reviewChoice.click();
  await expect(page.getByLabel("Target word", { exact: true })).toBeVisible();
  // This test adds a clearly identifiable fixture to a dedicated account; it remains saved.
  const target = `verification-${Date.now()}`;
  const original = "  I keep my original attempt, even with a mistakes.\nThis is my test.  ";
  await page.getByLabel("Target word", { exact: true }).fill(target);
  await page.getByLabel("Primary meaning", { exact: true }).fill("A test fixture, not an AWL claim.");
  await page.getByLabel("One source example", { exact: true }).fill("A manually entered test example.");
  await page.getByLabel("Words to work on this session").selectOption("3");
  const resume = page.getByRole("button", { name: "Resume stopwatch" });
  if (await resume.isVisible()) await resume.click();
  const timer = page.getByRole("timer");
  const before = await timer.textContent();
  await expect(timer).not.toHaveText(before!);
  await page.getByRole("button", { name: "Pause stopwatch" }).click();
  const paused = await timer.textContent();
  await page.waitForTimeout(1300); // Deliberately verify paused time does not advance.
  await expect(timer).toHaveText(paused!);
  await page.getByRole("button", { name: "Hide notes & write my sentence →" }).click();
  await expect(page.getByLabel("Primary meaning", { exact: true })).toHaveCount(0);
  await page.getByLabel("My first sentence", { exact: true }).fill(original);
  await page.reload();
  await expect(page.getByRole("button", { name: "Resume stopwatch" })).toBeVisible();
  const restore = page.getByRole("button", { name: "Restore local work" });
  if (await restore.isVisible()) await restore.click();
  const hideNotes = page.getByRole("button", { name: "Hide notes & write my sentence →" });
  if (await hideNotes.isVisible()) await hideNotes.click();
  await expect(page.getByLabel("My first sentence", { exact: true })).toHaveValue(original);
  await page.getByRole("button", { name: "Save word to My Words →" }).click();
  await expect(page).toHaveURL(/\/words\?saved=1$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: target, exact: true })).toBeVisible();
  const evidence = page.locator("article").filter({ has: page.getByRole("heading", { name: target, exact: true }) }).locator(".preserved-text").first();
  expect(await evidence.textContent()).toBe(original);
  await page.getByRole("link", { name: "Continue draft →" }).click();
  await page.getByLabel("Words to work on this session").selectOption("1");
  await expect(page.getByText("Selected word count reached: 1/1.")).toBeVisible();
  await page.getByLabel("Target word", { exact: true }).fill("unfinished-test-word");
  await page.getByRole("button", { name: "Close unfinished session", exact: true }).click();
  await page.getByRole("button", { name: "Close & keep history", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Session history", exact: true })).toBeVisible();
  await page.getByText("Preserved unfinished work · read-only", { exact: true }).first().click();
  await expect(page.getByText("unfinished-test-word", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("No active draft. Start a new session whenever you are ready.")).toBeVisible();
  await page.getByRole("link", { name: "My Words", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: target, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/words");
  await expect(page).toHaveURL(/\/login$/);
});
