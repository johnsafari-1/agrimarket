const { chromium } = require("playwright");
const http = require("http"),
  fs = require("fs"),
  path = require("path"),
  assert = require("assert");
const root = path.join(__dirname, "ui-artifacts");
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split("?")[0]);
  let filename = pathname.startsWith("/assets/")
    ? path.join(__dirname, "../public", pathname)
    : path.join(root, pathname);
  try {
    let body = fs.readFileSync(filename);
    res.setHeader(
      "Content-Type",
      filename.endsWith(".css")
        ? "text/css"
        : filename.endsWith(".js")
          ? "text/javascript"
          : filename.endsWith(".json")
            ? "application/json"
            : "text/html",
    );
    res.end(body);
  } catch (e) {
    res.statusCode = 404;
    res.end("Not found");
  }
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let failure = false;
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(root, "snapshot.json"), "utf8"),
  );
  await page.route("**/order_tracking.php*", (route) =>
    route.fulfill(
      failure
        ? { status: 503, contentType: "application/json", body: "{}" }
        : {
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(snapshot),
          },
    ),
  );
  await page.goto(`http://127.0.0.1:${port}/order.html`);
  await page.waitForFunction(
    () =>
      document.querySelector("#refresh-tracking").textContent ===
      "Refresh updates",
  );
  await page.screenshot({
    path: path.join(root, "order-desktop.png"),
    fullPage: true,
  });
  const previous = await page.locator("#timeline-events").textContent();
  failure = true;
  await page.click("#refresh-tracking");
  await page.waitForSelector(".tracking-note.error");
  assert.equal(await page.locator("#timeline-events").textContent(), previous);
  assert(
    (await page.locator("#tracking-notice").textContent()).includes(
      "last recorded",
    ),
  );
  failure = false;
  snapshot.events[2].note = "<img src=x onerror=alert(1)>";
  await page.click("#refresh-tracking");
  await page.waitForFunction(
    () =>
      !document.querySelector("#tracking-notice").classList.contains("error"),
  );
  assert.equal(await page.locator("#timeline-events img").count(), 0);
  assert(
    (await page.locator("#timeline-events").textContent()).includes(
      "<img src=x",
    ),
  );
  snapshot.events[2].note =
    "Dispatched from Nakuru. Your farmer will contact you before arrival.";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#refresh-tracking");
  await page.screenshot({
    path: path.join(root, "order-mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.click("[data-toggle-sidebar]");
  assert.equal(
    await page.getAttribute("[data-toggle-sidebar]", "aria-expanded"),
    "true",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getAttribute("[data-toggle-sidebar]", "aria-expanded"),
    "false",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://127.0.0.1:${port}/login.html`);
  await page.screenshot({
    path: path.join(root, "login-desktop.png"),
    fullPage: true,
  });
  await page.fill("#loginPassword", "example-password");
  await page.click("[data-password-toggle=loginPassword]");
  assert.equal(await page.getAttribute("#loginPassword", "type"), "text");
  await page.click("[data-auth-tab=register]");
  assert(await page.locator("#panel-register").isVisible());
  await page.check("input[value=Farmer]");
  assert(await page.locator("#businessNameField").isVisible());
  assert.equal(await page.getAttribute("#regBusinessName", "required"), "");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(root, "registration-mobile.png"),
    fullPage: true,
  });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS desktop/mobile render, navigation, password visibility, registration role, escaped tracking notes and retained state on refresh failure.",
  );
  await browser.close();
  await new Promise((r) => server.close(r));
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
