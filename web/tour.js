// Guided tour: dims the page and highlights one part at a time, with a small
// card explaining it. Steps whose target isn't on screen (e.g. the chaos
// chart while the comparison is off) are skipped.

const PAD = 6; // space between a highlighted element and the highlight's edge
const GAP = 14; // space between the highlight and the explanation card

const root = document.getElementById("tour");
const spot = root.querySelector(".tour-spot");
const tip = root.querySelector(".tour-tip");
const stepLabel = root.querySelector(".tour-step");
const title = root.querySelector(".tour-title");
const text = root.querySelector(".tour-text");
const back = root.querySelector(".tour-back");
const next = root.querySelector(".tour-next");

let steps = [];
let index = 0;
let onEnd = () => {};

export const tourActive = () => !root.hidden;

/**
 * steps: [{target: () => Element | DOMRect, title, text, enter}]; enter (optional)
 * runs when the step opens, e.g. to load the preset it talks about.
 * onEnd: called when the tour finishes or is skipped.
 */
export function startTour(tourSteps, { onEnd: done = () => {} } = {}) {
  steps = tourSteps.filter((s) => isShown(s.target()));
  onEnd = done;
  root.hidden = false;
  show(0);
}

function endTour() {
  root.hidden = true;
  onEnd();
}

function isShown(target) {
  if (target instanceof DOMRect) return target.width > 0;
  return target && target.getClientRects().length > 0;
}

function show(i) {
  index = i;
  const step = steps[i];
  stepLabel.textContent = `${i + 1} of ${steps.length}`;
  step.enter?.();
  title.textContent = step.title;
  text.innerHTML = step.text;
  back.disabled = i === 0;
  next.textContent = i === steps.length - 1 ? "Finish" : "Next";
  const target = step.target();
  if (target instanceof Element) target.scrollIntoView({ block: "nearest" });
  position();
  next.focus({ preventScroll: true });
}

/** Put the highlight over the current target and the card beside it. */
function position() {
  if (root.hidden) return;
  const target = steps[index].target();
  const r = target instanceof DOMRect ? target : target.getBoundingClientRect();
  const big = r.width * r.height > 0.25 * window.innerWidth * window.innerHeight;
  const inset = big ? 8 : -PAD; // a big area (the 3D view) is outlined just inside its edges
  Object.assign(spot.style, {
    left: `${r.left + inset}px`,
    top: `${r.top + inset}px`,
    width: `${r.width - 2 * inset}px`,
    height: `${r.height - 2 * inset}px`,
  });

  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x) => Math.min(Math.max(x, 12), vw - w - 12);
  const clampY = (y) => Math.min(Math.max(y, 12), vh - h - 12);
  let x;
  let y;
  if (big) {
    // Over the 3D view: centre the card near its bottom.
    x = clampX(r.left + r.width / 2 - w / 2);
    y = clampY(r.bottom - h - 40);
  } else if (r.right + PAD + GAP + w <= vw - 12) {
    // Panel items on a wide screen: to the right of the highlight.
    x = r.right + PAD + GAP;
    y = clampY(r.top + r.height / 2 - h / 2);
  } else if (r.top - PAD - GAP - h >= 12) {
    // Narrow screen (panel at the bottom): above the highlight.
    x = clampX(r.left + r.width / 2 - w / 2);
    y = r.top - PAD - GAP - h;
  } else {
    x = clampX(r.left + r.width / 2 - w / 2);
    y = clampY(r.bottom + PAD + GAP);
  }
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

back.addEventListener("click", () => index > 0 && show(index - 1));
next.addEventListener("click", () => (index < steps.length - 1 ? show(index + 1) : endTour()));
root.querySelector(".tour-skip").addEventListener("click", endTour);
window.addEventListener("resize", position);
document.getElementById("panel").addEventListener("scroll", position, true); // true: also the experiments list inside it

// While the tour is open it owns the keyboard (capture phase, so the
// simulation's own shortcuts like Space don't fire underneath).
window.addEventListener("keydown", (e) => {
  if (root.hidden) return;
  e.stopPropagation();
  if (e.key === "Escape") endTour();
  else if (e.key === "ArrowRight" || e.key === "Enter") {
    e.preventDefault();
    next.click();
  } else if (e.key === "ArrowLeft") {
    e.preventDefault();
    back.click();
  }
}, true);
