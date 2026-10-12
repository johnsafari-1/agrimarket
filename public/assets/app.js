// Plain JavaScript — navbar collapse toggle and dismissible alerts.
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll(".navbar-toggler").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.querySelector(btn.getAttribute("data-bs-target"));
      if (target) target.classList.toggle("show");
    });
  });
  document.querySelectorAll(".alert .btn-close").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var alert = btn.closest(".alert");
      if (alert) alert.remove();
    });
  });
});

document.addEventListener("DOMContentLoaded", function () {
  const toggle = document.querySelector("[data-toggle-sidebar]");
  const sidebar = document.getElementById("app-navigation");
  const backdrop = document.querySelector("[data-close-sidebar]");
  function closeNavigation() {
    document.body.classList.remove("navigation-open");
    if (backdrop) backdrop.hidden = true;
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
    }
  }
  if (toggle)
    toggle.addEventListener("click", function () {
      const open = document.body.classList.toggle("navigation-open");
      toggle.setAttribute("aria-expanded", String(open));
      backdrop.hidden = !open;
      if (open && sidebar) sidebar.querySelector("a").focus();
    });
  document
    .querySelectorAll("[data-close-sidebar]")
    .forEach((el) => el.addEventListener("click", closeNavigation));
  document.addEventListener("keydown", function (event) {
    if (!document.body.classList.contains("navigation-open")) return;
    if (event.key === "Escape") closeNavigation();
    if (event.key === "Tab" && sidebar) {
      const focusable = Array.from(sidebar.querySelectorAll("a,button")).filter(
        (el) => el.offsetParent !== null,
      );
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1).focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === focusable.at(-1)
      ) {
        event.preventDefault();
        focusable[0].focus();
      }
    }
  });
  document.querySelectorAll("[data-auth-tab]").forEach(function (tab) {
    tab.addEventListener("click", function (event) {
      event.preventDefault();
      const name = tab.dataset.authTab;
      document.querySelectorAll("[data-auth-tab]").forEach((t) => {
        t.classList.toggle("active", t === tab);
        t.setAttribute("aria-selected", String(t === tab));
      });
      document.getElementById("panel-login").hidden = name !== "login";
      document.getElementById("panel-register").hidden = name !== "register";
      history.replaceState(null, "", tab.href);
    });
  });
  const business = document.getElementById("businessNameField");
  function updateRole() {
    const farmer =
      document.querySelector('input[name="role"]:checked')?.value === "Farmer";
    if (business) {
      business.hidden = !farmer;
      business.querySelector("input").required = farmer;
    }
  }
  document
    .querySelectorAll('input[name="role"]')
    .forEach((input) => input.addEventListener("change", updateRole));
  updateRole();
  document
    .querySelectorAll("[data-password-toggle]")
    .forEach(function (button) {
      button.addEventListener("click", function () {
        const input = document.getElementById(button.dataset.passwordToggle);
        const reveal = input.type === "password";
        input.type = reveal ? "text" : "password";
        button.textContent = reveal ? "Hide" : "Show";
        button.setAttribute("aria-pressed", String(reveal));
        button.setAttribute(
          "aria-label",
          reveal ? "Hide password" : "Show password",
        );
      });
    });

  const tracker = document.querySelector("[data-order-tracking]");
  if (!tracker) return;
  const orderId = Number(tracker.dataset.orderId);
  const button = document.getElementById("refresh-tracking");
  const notice = document.getElementById("tracking-notice");
  const stages = ["Pending", "Confirmed", "Shipped", "Delivered"];
  const headlines = {
    Pending: "Waiting for confirmation",
    Confirmed: "Your order is being prepared",
    Shipped: "Your order is on its way",
    Delivered: "Delivered. Enjoy your produce.",
    Cancelled: "This order was cancelled",
  };
  const dateFormat = new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  });
  const moneyFormat = new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
  });
  let generation = 0,
    controller,
    timer,
    stopped = false;
  function draw(snapshot) {
    if (
      snapshot.id !== orderId ||
      !headlines[snapshot.status] ||
      !Array.isArray(snapshot.events) ||
      !Array.isArray(snapshot.payments)
    )
      throw new Error("Invalid tracking response.");
    document.getElementById("tracking-headline").textContent =
      headlines[snapshot.status];
    document.getElementById("tracking-status").textContent =
      snapshot.status + " · We'll keep your delivery updates here.";
    document.getElementById("expected-delivery").textContent =
      snapshot.expected_date
        ? new Intl.DateTimeFormat("en-KE", {
            day: "numeric",
            month: "short",
            year: "numeric",
          }).format(new Date(snapshot.expected_date + "T12:00:00"))
        : "Awaiting confirmation";
    document.getElementById("expected-window").textContent =
      snapshot.expected_window || "";
    document.querySelectorAll("[data-step]").forEach(function (step) {
      const index = stages.indexOf(step.dataset.step);
      const current = stages.indexOf(snapshot.status);
      step.classList.toggle("complete", current >= 0 && index < current);
      step.classList.toggle("current", step.dataset.step === snapshot.status);
      if (step.dataset.step === snapshot.status)
        step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
    const timeline = document.getElementById("timeline-events");
    const fragment = document.createDocumentFragment();
    snapshot.events.forEach(function (event) {
      const li = document.createElement("li"),
        title = document.createElement("strong"),
        note = document.createElement("p"),
        time = document.createElement("time");
      title.textContent = event.status;
      note.textContent = event.note;
      time.dateTime = event.at;
      time.textContent = dateFormat.format(new Date(event.at));
      li.append(title, note, time);
      fragment.append(li);
    });
    if (!snapshot.events.length) {
      const li = document.createElement("li");
      li.textContent = "No earlier status updates were recorded.";
      fragment.append(li);
    }
    timeline.replaceChildren(fragment);
    const payments = document.getElementById("tracking-payments");
    const paymentFragment = document.createDocumentFragment();
    snapshot.payments.forEach(function (payment) {
      const row = document.createElement("div"),
        detail = document.createElement("span"),
        amount = document.createElement("small"),
        status = document.createElement("span");
      row.className = "payment-row";
      detail.textContent = payment.payment_method;
      amount.className = "d-block text-muted";
      amount.textContent = moneyFormat.format(Number(payment.amount));
      detail.append(amount);
      status.className =
        "badge bg-" +
        (payment.payment_status === "Completed"
          ? "success"
          : payment.payment_status === "Failed"
            ? "danger"
            : "warning");
      status.textContent = payment.payment_status;
      row.append(detail, status);
      paymentFragment.append(row);
    });
    payments.replaceChildren(paymentFragment);
    const cancel = document.getElementById("cancel-order-section");
    if (cancel) cancel.hidden = snapshot.status !== "Pending";
    document.getElementById("tracking-updated").textContent =
      "Checked at " +
      new Date().toLocaleTimeString("en-KE") +
      " · Updates every 30 seconds while this page is open.";
    stopped =
      ["Delivered", "Cancelled"].includes(snapshot.status) &&
      !snapshot.payments.some((p) => p.payment_status === "Pending");
  }
  async function refresh() {
    clearTimeout(timer);
    if (controller) controller.abort();
    controller = new AbortController();
    const requestGeneration = ++generation;
    button.disabled = true;
    button.textContent = "Checking…";
    try {
      const response = await fetch("order_tracking.php?id=" + orderId, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        stopped = true;
        throw new Error(
          "Your session has expired or access changed. Please sign in again.",
        );
      }
      if (!response.ok)
        throw new Error(
          "Updates are unavailable. Your last recorded details are still shown; try Refresh updates again.",
        );
      const snapshot = await response.json();
      if (requestGeneration !== generation) return;
      draw(snapshot);
      notice.textContent =
        "Delivery progress is updated by the farmer. Location is not tracked.";
      notice.classList.remove("error");
    } catch (error) {
      if (error.name !== "AbortError" && requestGeneration === generation) {
        notice.textContent = error.message;
        notice.classList.add("error");
      }
    } finally {
      if (requestGeneration === generation) {
        button.disabled = false;
        button.textContent = "Refresh updates";
        if (!stopped && document.visibilityState === "visible")
          timer = setTimeout(refresh, 30000);
      }
    }
  }
  button.addEventListener("click", refresh);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimeout(timer);
      if (controller) controller.abort();
    } else if (!stopped) refresh();
  });
  window.addEventListener("pagehide", function () {
    clearTimeout(timer);
    if (controller) controller.abort();
  });
  refresh();
});
